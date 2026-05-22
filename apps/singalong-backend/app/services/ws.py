from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect
from sqlalchemy.orm import Session

from .download_queue import list_active_download_items
from .session_queue import (
    advance_playing_queue_item,
    list_session_queue_items,
    update_top_pending_playback_state,
)
from ..schemas import SessionQueueItem, SongDownloadItem

WEBSOCKET_CHANNELS = ("player", "admin", "guest")
GLOBAL_DOWNLOAD_SCOPE = "__downloads__"
ADMIN_TO_PLAYER_TYPES = {
    "queue.updated",
    "playback.play",
    "playback.pause",
    "playback.skip",
    "playback.seek",
    "playback.volume",
    "session.ended",
}
PLAYER_TO_ADMIN_TYPES = {
    "playback.position",
    "playback.ended",
}


class SessionWebSocketHub:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._event_loop: asyncio.AbstractEventLoop | None = None
        self._connections: dict[str, dict[str, set[WebSocket]]] = defaultdict(
            lambda: {channel: set() for channel in WEBSOCKET_CHANNELS}
        )
        self._connection_users: dict[str, dict[str, dict[WebSocket, str | None]]] = defaultdict(
            lambda: {channel: {} for channel in WEBSOCKET_CHANNELS}
        )

    def bind_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._event_loop = loop

    async def run_connection(
        self,
        websocket: WebSocket,
        channel: str,
        session_code: str | None,
        db: Session | None = None,
        username: str | None = None,
    ) -> None:
        scope = session_code or GLOBAL_DOWNLOAD_SCOPE
        await websocket.accept()
        await self._register(websocket, channel, scope, username)
        await self._send(
            websocket,
            {
                "type": "connection.ready",
                "session_code": session_code or "",
                "payload": {"channel": channel},
            },
        )
        if channel == "admin":
            await self._send_admin_placeholder_events(websocket, session_code, db)
        if channel == "guest":
            await self._send_download_snapshot(websocket, session_code, db)

        try:
            while True:
                incoming = await websocket.receive_json()
                event = self._normalize_event(incoming)
                if event is None:
                    await self._send_error(websocket, session_code or "", "Invalid websocket event payload")
                    continue

                await self._route_event(
                    sender=websocket,
                    source_channel=channel,
                    session_code=scope,
                    event_type=event["type"],
                    payload=event["payload"],
                    db=db,
                )
        except WebSocketDisconnect:
            return
        finally:
            await self._unregister(websocket, channel, scope)

    async def broadcast_session_ended(self, session_code: str) -> None:
        message = {
            "type": "session.ended",
            "session_code": session_code,
            "payload": {"reason": "archived"},
        }
        await self._broadcast(session_code, "player", message)
        await self._broadcast(session_code, "admin", message)
        await self._broadcast(session_code, "guest", message)

    async def _route_event(
        self,
        sender: WebSocket,
        source_channel: str,
        session_code: str,
        event_type: str,
        payload: dict[str, Any],
        db: Session | None = None,
    ) -> None:
        message = {
            "type": event_type,
            "session_code": session_code,
            "payload": payload,
        }

        if source_channel == "admin":
            if event_type in ADMIN_TO_PLAYER_TYPES:
                if event_type == "playback.skip":
                    if db is None:
                        await self._send_error(sender, session_code, "Playback transition requires database session")
                        return
                    try:
                        items = advance_playing_queue_item(
                            db,
                            session_code,
                            completion_status="skipped",
                        )
                    except Exception as exc:
                        await self._send_error(sender, session_code, f"Failed to advance queue: {exc}")
                        return
                    await self.broadcast_queue_updated(session_code, items)
                    return
                if db is not None and event_type.startswith("playback."):
                    try:
                        self._persist_admin_playback_event(db, session_code, event_type, payload)
                    except Exception as exc:
                        await self._send_error(sender, session_code, f"Failed to persist playback state: {exc}")
                        return
                await self._broadcast(session_code, "player", message)
                if event_type == "queue.updated":
                    await self._broadcast(session_code, "guest", message)
                return
            if event_type == "downloads.updated":
                await self._broadcast(session_code, "admin", message, exclude=sender)
                return
            await self._send_error(sender, session_code, f"Unsupported admin event type: {event_type}")
            return

        if source_channel == "player":
            if event_type in PLAYER_TO_ADMIN_TYPES:
                if event_type == "playback.ended":
                    if db is None:
                        await self._send_error(sender, session_code, "Playback transition requires database session")
                        return
                    try:
                        items = advance_playing_queue_item(
                            db,
                            session_code,
                            completion_status="finished",
                        )
                    except Exception as exc:
                        await self._send_error(sender, session_code, f"Failed to advance queue: {exc}")
                        return
                    await self.broadcast_queue_updated(session_code, items)
                if db is not None and event_type != "playback.ended":
                    try:
                        self._persist_player_playback_event(db, session_code, event_type, payload)
                    except Exception as exc:
                        await self._send_error(sender, session_code, f"Failed to persist playback state: {exc}")
                        return
                await self._broadcast(session_code, "admin", message)
                return
            await self._send_error(sender, session_code, f"Unsupported player event type: {event_type}")
            return

        if source_channel == "guest":
            await self._send_error(sender, session_code, "Guest websocket is receive-only in this phase")
            return

    async def _register(
        self,
        websocket: WebSocket,
        channel: str,
        session_code: str,
        username: str | None = None,
    ) -> None:
        async with self._lock:
            self._connections[session_code][channel].add(websocket)
            self._connection_users[session_code][channel][websocket] = username

    async def _unregister(self, websocket: WebSocket, channel: str, session_code: str) -> None:
        async with self._lock:
            session_connections = self._connections.get(session_code)
            if session_connections is None:
                return

            session_connections[channel].discard(websocket)
            session_users = self._connection_users.get(session_code)
            if session_users is not None:
                session_users[channel].pop(websocket, None)
            if all(len(channel_connections) == 0 for channel_connections in session_connections.values()):
                self._connections.pop(session_code, None)
                self._connection_users.pop(session_code, None)

    async def _broadcast(
        self,
        session_code: str,
        target_channel: str,
        payload: dict[str, Any],
        exclude: WebSocket | None = None,
    ) -> None:
        async with self._lock:
            targets = list(self._connections.get(session_code, {}).get(target_channel, set()))

        for websocket in targets:
            if exclude is not None and websocket is exclude:
                continue
            await self._send(websocket, payload)

    async def _send(self, websocket: WebSocket, payload: dict[str, Any]) -> None:
        try:
            await websocket.send_json(payload)
        except RuntimeError:
            return

    async def _send_error(self, websocket: WebSocket, session_code: str, message: str) -> None:
        await self._send(
            websocket,
            {
                "type": "error",
                "session_code": session_code,
                "payload": {"message": message},
            },
        )

    async def _send_admin_placeholder_events(
        self,
        websocket: WebSocket,
        session_code: str | None,
        db: Session | None = None,
    ) -> None:
        download_items = list_active_download_items(db) if db is not None else []
        queue_items: list[SessionQueueItem] = []
        if db is not None and session_code is not None and session_code != "":
            try:
                queue_items = list_session_queue_items(db, session_code)
            except Exception:
                queue_items = []
        scoped_session_code = session_code or ""
        await self._send(
            websocket,
            {
                "type": "queue.updated",
                "session_code": scoped_session_code,
                "payload": {"items": [item.model_dump(mode="json") for item in queue_items]},
            },
        )
        await self._send(
            websocket,
            {
                "type": "downloads.updated",
                "session_code": scoped_session_code,
                "payload": {"items": [item.model_dump(mode="json") for item in download_items]},
            },
        )

    async def _send_download_snapshot(
        self,
        websocket: WebSocket,
        session_code: str | None,
        db: Session | None = None,
    ) -> None:
        download_items = list_active_download_items(db) if db is not None else []
        await self._send(
            websocket,
            {
                "type": "downloads.updated",
                "session_code": session_code or "",
                "payload": {"items": [item.model_dump(mode="json") for item in download_items]},
            },
        )

    async def broadcast_downloads_updated(self, items: list[SongDownloadItem]) -> None:
        payload = {
            "type": "downloads.updated",
            "session_code": "",
            "payload": {"items": [item.model_dump(mode="json") for item in items]},
        }
        await self._broadcast_all("admin", payload)
        await self._broadcast(GLOBAL_DOWNLOAD_SCOPE, "guest", payload)

    async def broadcast_queue_updated(self, session_code: str, items: list[SessionQueueItem]) -> None:
        payload = {
            "type": "queue.updated",
            "session_code": session_code,
            "payload": {"items": [item.model_dump(mode="json") for item in items]},
        }
        await self._broadcast(session_code, "player", payload)
        await self._broadcast(session_code, "admin", payload)
        await self._broadcast(session_code, "guest", payload)

    async def get_presence_snapshot(self, session_code: str) -> dict[str, Any]:
        async with self._lock:
            channels = self._connections.get(session_code)
            user_channels = self._connection_users.get(session_code)
            if channels is None:
                return {
                    "player_connected": False,
                    "admin_connected_count": 0,
                    "guest_connected_count": 0,
                    "online_usernames": set(),
                }
            online_usernames = set()
            if user_channels is not None:
                for channel_map in user_channels.values():
                    online_usernames.update(
                        username for username in channel_map.values() if isinstance(username, str) and username != ""
                    )
            return {
                "player_connected": len(channels.get("player", set())) > 0,
                "admin_connected_count": len(channels.get("admin", set())),
                "guest_connected_count": len(channels.get("guest", set())),
                "online_usernames": online_usernames,
            }

    def broadcast_downloads_updated_threadsafe(self, items: list[SongDownloadItem]) -> None:
        if self._event_loop is None:
            return
        asyncio.run_coroutine_threadsafe(self.broadcast_downloads_updated(items), self._event_loop)

    def broadcast_queue_updated_threadsafe(self, session_code: str, items: list[SessionQueueItem]) -> None:
        if self._event_loop is None:
            return
        asyncio.run_coroutine_threadsafe(self.broadcast_queue_updated(session_code, items), self._event_loop)

    async def _broadcast_all(self, target_channel: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            targets = [
                websocket
                for channels in self._connections.values()
                for websocket in channels.get(target_channel, set())
            ]
        for websocket in targets:
            await self._send(websocket, payload)

    def _normalize_event(self, payload: Any) -> dict[str, Any] | None:
        if not isinstance(payload, dict):
            return None

        event_type = payload.get("type")
        event_payload = payload.get("payload", {})
        if not isinstance(event_type, str) or event_type.strip() == "":
            return None
        if not isinstance(event_payload, dict):
            return None

        return {
            "type": event_type.strip(),
            "payload": event_payload,
        }

    def _persist_admin_playback_event(
        self,
        db: Session,
        session_code: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        position_seconds: float | None = None
        volume_pct: int | None = None
        is_playing: bool | None = None

        if event_type == "playback.play":
            is_playing = True
        elif event_type == "playback.pause":
            is_playing = False
        elif event_type == "playback.skip":
            position_seconds = 0
            is_playing = False
        elif event_type == "playback.seek":
            raw_position = payload.get("position_seconds")
            if isinstance(raw_position, (int, float)):
                position_seconds = float(raw_position)
        elif event_type == "playback.volume":
            raw_volume = payload.get("volume_pct")
            if isinstance(raw_volume, (int, float)):
                volume_pct = int(raw_volume)
            else:
                volume = payload.get("volume")
                if isinstance(volume, (int, float)):
                    volume_pct = int(round(float(volume) * 100 if float(volume) <= 1 else float(volume)))

        update_top_pending_playback_state(
            db,
            session_code,
            position_seconds=position_seconds,
            volume_pct=volume_pct,
            is_playing=is_playing,
        )

    def _persist_player_playback_event(
        self,
        db: Session,
        session_code: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        position_seconds: float | None = None
        volume_pct: int | None = None
        is_playing: bool | None = None

        if event_type == "playback.position":
            raw_position = payload.get("position_seconds")
            if isinstance(raw_position, (int, float)):
                position_seconds = float(raw_position)

            raw_volume_pct = payload.get("volume_pct")
            if isinstance(raw_volume_pct, (int, float)):
                volume_pct = int(round(float(raw_volume_pct)))

            raw_is_playing = payload.get("is_playing")
            if isinstance(raw_is_playing, bool):
                is_playing = raw_is_playing
        elif event_type == "playback.ended":
            is_playing = False

        update_top_pending_playback_state(
            db,
            session_code,
            position_seconds=position_seconds,
            volume_pct=volume_pct,
            is_playing=is_playing,
        )


ws_hub = SessionWebSocketHub()
