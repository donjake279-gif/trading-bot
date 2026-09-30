@echo off
cd /d "%~dp0"
echo ============================================================
echo  S1 backtest: does the strategy have an edge after costs?
echo  Runs 2020-2023, the same at 1.5x costs, and 2024.
echo  Needs the history from 2_download_history.bat.
echo  Takes about 5-15 minutes. It never trades.
echo ============================================================
echo.
python main.py backtest --check --open
echo.
echo Reports are in the "reports" folder.
pause
