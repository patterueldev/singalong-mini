from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect
from sqlalchemy.orm import Session

from .download_queue import list_active_download_items

WEBSOCKET_CHANNELS = ("player", "admin", "guest")
ADMIN_TO_PLAYER_TYPES = {
    "queue.updated",
    "playback.play",
    "playback.pause",
    "playback.skip",
    "playback.seek",
    "session.ended",
}
PLAYER_TO_ADMIN_TYPES = {
    "playback.position",
    "playback.ended",
}


class SessionWebSocketHub:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._connections: dict[str, dict[str, set[WebSocket]]] = defaultdict(
            lambda: {channel: set() for channel in WEBSOCKET_CHANNELS}
        )

    async def run_connection(
        self,
        websocket: WebSocket,
        channel: str,
        session_code: str,
        db: Session | None = None,
    ) -> None:
        await websocket.accept()
        await self._register(websocket, channel, session_code)
        await self._send(
            websocket,
            {
                "type": "connection.ready",
                "session_code": session_code,
                "payload": {"channel": channel},
            },
        )
        if channel == "admin":
            await self._send_admin_placeholder_events(websocket, session_code, db)

        try:
            while True:
                incoming = await websocket.receive_json()
                event = self._normalize_event(incoming)
                if event is None:
                    await self._send_error(websocket, session_code, "Invalid websocket event payload")
                    continue

                await self._route_event(
                    sender=websocket,
                    source_channel=channel,
                    session_code=session_code,
                    event_type=event["type"],
                    payload=event["payload"],
                )
        except WebSocketDisconnect:
            return
        finally:
            await self._unregister(websocket, channel, session_code)

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
    ) -> None:
        message = {
            "type": event_type,
            "session_code": session_code,
            "payload": payload,
        }

        if source_channel == "admin":
            if event_type in ADMIN_TO_PLAYER_TYPES:
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
                await self._broadcast(session_code, "admin", message)
                return
            await self._send_error(sender, session_code, f"Unsupported player event type: {event_type}")
            return

        if source_channel == "guest":
            await self._send_error(sender, session_code, "Guest websocket is receive-only in this phase")
            return

    async def _register(self, websocket: WebSocket, channel: str, session_code: str) -> None:
        async with self._lock:
            self._connections[session_code][channel].add(websocket)

    async def _unregister(self, websocket: WebSocket, channel: str, session_code: str) -> None:
        async with self._lock:
            session_connections = self._connections.get(session_code)
            if session_connections is None:
                return

            session_connections[channel].discard(websocket)
            if all(len(channel_connections) == 0 for channel_connections in session_connections.values()):
                self._connections.pop(session_code, None)

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
        session_code: str,
        db: Session | None = None,
    ) -> None:
        download_items = list_active_download_items(db) if db is not None else []
        await self._send(
            websocket,
            {
                "type": "queue.updated",
                "session_code": session_code,
                "payload": {
                    "items": [
                        {
                            "id": "mock-song-1",
                            "title": "Bohemian Rhapsody",
                            "artist": "Queen",
                            "status": "queued",
                        },
                        {
                            "id": "mock-song-2",
                            "title": "Dancing Queen",
                            "artist": "ABBA",
                            "status": "queued",
                        },
                    ]
                },
            },
        )
        await self._send(
            websocket,
            {
                "type": "downloads.updated",
                "session_code": session_code,
                "payload": {"items": [item.model_dump(mode="json") for item in download_items]},
            },
        )

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


ws_hub = SessionWebSocketHub()
