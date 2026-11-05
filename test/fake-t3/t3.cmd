@echo off
node "%~dp0fake-t3.mjs" %*
exit /b %ERRORLEVEL%
