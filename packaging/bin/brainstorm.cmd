@echo off
rem The brainstorm command of an installed app. It runs the CLI on the app's own Electron in node mode, so the
rem machine needs no Node. The installer puts this folder on the user's PATH.
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\Brainstorm.exe" "%~dp0..\app\dist\cli\main.js" %*
exit /b %ERRORLEVEL%
