"""MT5 trading system — command-line entry point.

    python main.py diagnose                      read-only check of MT5, account, time, symbols, data
    python main.py download-data [--start ...]   download M1 history to data/history (for backtests)
    python main.py run                           (not built yet — STEP 14)
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from core.config import ConfigError, load_credentials, load_settings
from core.logging_setup import configure_logging


def _date(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="main.py", description="MT5 rules-based trading system")
    parser.add_argument("--config", default=str(ROOT / "config" / "settings.yaml"))
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("diagnose", help="read-only health check (never trades)")
    dl = sub.add_parser("download-data", help="download M1 history for backtesting")
    dl.add_argument("--start", type=_date, default=_date("2020-01-01"))
    dl.add_argument("--end", type=_date, default=None, help="default: now")
    dl.add_argument("--force", action="store_true", help="re-download years that already exist")
    sub.add_parser("run", help="start the trading loop (not available yet)")
    args = parser.parse_args(argv)

    configure_logging(ROOT / "logs", console=False)
    try:
        settings = load_settings(args.config)
    except ConfigError as exc:
        print(f"CONFIG ERROR:\n{exc}")
        return 2
    creds = load_credentials(ROOT / ".env")

    if args.command == "diagnose":
        from app.diagnose import run_diagnose

        return run_diagnose(settings, creds, ROOT / "logs")
    if args.command == "download-data":
        from app.download import run_download

        end = args.end or datetime.now(timezone.utc)
        return run_download(settings, creds, args.start, end, args.force, ROOT)
    if args.command == "run":
        print("The trading loop is not built yet. Strategy, risk, execution and safety modules come in "
              "STEPS 4-14. Nothing will be traded. Use `python main.py diagnose` for now.")
        return 3
    return 2


if __name__ == "__main__":
    sys.exit(main())
