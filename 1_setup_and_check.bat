@echo off
cd /d "%~dp0"
echo ============================================
echo  MT5 trading bot - install and health check
echo  (keep MetaTrader 5 open and logged in)
echo ============================================
echo.
echo [1/3] Installing Python packages (first time takes a few minutes)...
python -m pip install -r requirements.txt
echo.
echo [2/3] Running automated tests...
python -m pytest -q
echo.
echo [3/3] Read-only health check (never trades)...
python main.py diagnose
echo.
echo Done. The report is saved in the logs folder.
pause
