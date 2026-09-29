@echo off
cd /d "%~dp0"
echo Downloading price history from Oct 2019 (MetaTrader 5 must be open).
echo This can take a while the first time.
python main.py download-data --start 2019-10-01
echo.
pause
