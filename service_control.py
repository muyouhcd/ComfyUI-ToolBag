import os
from asyncio import AbstractEventLoop
from collections.abc import Callable


RESTART_EXIT_CODE = 75


class ServiceRestartController:
    def __init__(self, exit_process: Callable[[int], None] = os._exit):
        self._exit_process = exit_process
        self._scheduled = False

    @property
    def supported(self) -> bool:
        return os.name != "nt" and bool(os.environ.get("INVOCATION_ID"))

    @property
    def scheduled(self) -> bool:
        return self._scheduled

    def schedule(
        self,
        loop: AbstractEventLoop,
        delay_seconds: float = 0.75,
    ) -> bool:
        if self._scheduled:
            return False
        self._scheduled = True
        loop.call_later(delay_seconds, self._exit_process, RESTART_EXIT_CODE)
        return True
