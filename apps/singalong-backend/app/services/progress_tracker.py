"""
Simple in-memory progress tracking for long-running operations.
"""
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict


@dataclass
class ProgressEvent:
    """Tracks progress of a long-running operation."""
    operation_id: str
    status: str  # 'started', 'processing', 'completed', 'failed'
    progress_percent: int = 0
    message: str = ''
    error: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    def to_dict(self) -> dict:
        return {
            'operation_id': self.operation_id,
            'status': self.status,
            'progress_percent': self.progress_percent,
            'message': self.message,
            'error': self.error,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }


class ProgressTracker:
    """Global progress tracker for operations."""
    
    def __init__(self):
        self._operations: Dict[str, ProgressEvent] = {}
    
    def start(self, operation_type: str = 'trim') -> str:
        """Start tracking a new operation, return operation_id."""
        operation_id = str(uuid.uuid4())
        self._operations[operation_id] = ProgressEvent(
            operation_id=operation_id,
            status='started',
            progress_percent=0,
            message=f'{operation_type} started',
        )
        return operation_id
    
    def update(self, operation_id: str, progress: int, message: str = '') -> None:
        """Update progress (0-100)."""
        if operation_id in self._operations:
            event = self._operations[operation_id]
            event.progress_percent = min(100, max(0, progress))
            event.status = 'processing'
            event.message = message
            event.updated_at = datetime.now(timezone.utc)
    
    def complete(self, operation_id: str, message: str = 'Completed') -> None:
        """Mark operation as completed."""
        if operation_id in self._operations:
            event = self._operations[operation_id]
            event.status = 'completed'
            event.progress_percent = 100
            event.message = message
            event.updated_at = datetime.now(timezone.utc)
    
    def fail(self, operation_id: str, error: str) -> None:
        """Mark operation as failed."""
        if operation_id in self._operations:
            event = self._operations[operation_id]
            event.status = 'failed'
            event.error = error
            event.updated_at = datetime.now(timezone.utc)
    
    def get(self, operation_id: str) -> ProgressEvent | None:
        """Get progress event."""
        return self._operations.get(operation_id)
    
    def cleanup(self, operation_id: str) -> None:
        """Remove operation from tracking (after download)."""
        self._operations.pop(operation_id, None)


# Global singleton
_tracker = ProgressTracker()


def get_progress_tracker() -> ProgressTracker:
    """Get the global progress tracker."""
    return _tracker
