; Puts the brainstorm command on the user's PATH: $INSTDIR\resources\bin holds brainstorm.cmd.
; An update runs the old uninstaller first, so the folder comes off PATH and goes straight back on.
!include "WinMessages.nsh"

!macro brainstormPath action
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\path.ps1" -Action ${action} -Dir "$INSTDIR\resources\bin"'
  Pop $0
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customInstall
  !insertmacro brainstormPath Add
!macroend

; Runs before the uninstaller deletes $INSTDIR, so path.ps1 is still there.
!macro customUnInstall
  !insertmacro brainstormPath Remove
!macroend
