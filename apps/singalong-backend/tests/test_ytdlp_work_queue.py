"""Tests for app.services.ytdlp.work_queue.YtDlpWorkQueue.

Issue #60: unbounded concurrent yt-dlp calls (one per search request) were a major
contributor to the file-descriptor exhaustion that crashed Postgres. These tests build a
small, isolated YtDlpWorkQueue (not the module-level singleton import.songs.py uses — a fresh
instance per test avoids any cross-test/process-global state) and assert:

1. Concurrent calls are capped at the configured limit — never more than `concurrency` in
   flight at once, even when more are queued.
2. All queued calls still complete once slots free up (this is a queue, not a rejector).
3. A call that can't get a slot within the wait budget fails fast with a 503 instead of
   hanging indefinitely, and likewise for a call that itself runs too long.

No FastAPI app, no DB — these run against the queue's asyncio primitives directly via
asyncio.run(), since the project doesn't currently depend on pytest-asyncio.
"""

import asyncio
import threading
import time

import pytest
from fastapi import HTTPException

from app.services.ytdlp.work_queue import YtDlpWorkQueue


def test_concurrency_is_capped_and_all_calls_complete():
    concurrency_limit = 3
    total_calls = 10
    in_flight = 0
    max_observed_in_flight = 0
    lock = threading.Lock()

    def tracked_call(call_index: int) -> int:
        nonlocal in_flight, max_observed_in_flight
        with lock:
            in_flight += 1
            max_observed_in_flight = max(max_observed_in_flight, in_flight)
        time.sleep(0.05)  # hold the "slot" briefly so overlapping calls are actually observed
        with lock:
            in_flight -= 1
        return call_index

    async def scenario():
        queue = YtDlpWorkQueue(concurrency=concurrency_limit, queue_max_wait_seconds=5, call_timeout_seconds=5)
        return sorted(await asyncio.gather(*(queue.run(lambda i=i: tracked_call(i)) for i in range(total_calls))))

    results = asyncio.run(scenario())

    assert results == list(range(total_calls)), "every queued call must eventually complete"
    assert max_observed_in_flight <= concurrency_limit, (
        f"observed {max_observed_in_flight} calls in flight at once, "
        f"expected the queue to cap concurrency at {concurrency_limit}"
    )
    assert max_observed_in_flight == concurrency_limit, "sanity check: the test should actually exercise the cap"


def test_wait_timeout_raises_503_instead_of_hanging():
    async def scenario():
        # concurrency=1 and a first call that holds its slot until released, so the second
        # call is guaranteed to exceed the (very short) wait budget.
        queue = YtDlpWorkQueue(concurrency=1, queue_max_wait_seconds=0.05, call_timeout_seconds=5)
        release_event = threading.Event()

        def hold_slot():
            release_event.wait(timeout=5)
            return "first"

        first_call = asyncio.ensure_future(queue.run(hold_slot))
        await asyncio.sleep(0.02)  # let the first call actually acquire its slot first

        with pytest.raises(HTTPException) as exc_info:
            await queue.run(lambda: "second")
        assert exc_info.value.status_code == 503

        release_event.set()
        assert await first_call == "first"

    asyncio.run(scenario())


def test_call_timeout_raises_503():
    async def scenario():
        queue = YtDlpWorkQueue(concurrency=1, queue_max_wait_seconds=5, call_timeout_seconds=0.05)

        def slow_call():
            time.sleep(0.2)
            return "too slow"

        with pytest.raises(HTTPException) as exc_info:
            await queue.run(slow_call)
        assert exc_info.value.status_code == 503

    asyncio.run(scenario())
