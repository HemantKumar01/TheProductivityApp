!define DEEP_FOCUS_SERVICE "DeepFocusBlocker"
!define DEEP_FOCUS_SERVICE_RELATIVE "resources\windows-service\deep-focus-service.exe"

!macro deepFocusRejectActive
  IfFileExists "$INSTDIR\${DEEP_FOCUS_SERVICE_RELATIVE}" 0 deep_focus_inactive
  nsExec::ExecToStack '"$INSTDIR\${DEEP_FOCUS_SERVICE_RELATIVE}" --status-active'
  Pop $0
  Pop $1
  StrCmp $0 "10" 0 deep_focus_inactive
  MessageBox MB_OK|MB_ICONSTOP "Deep Focus cannot be updated or removed while a focus session is active. Try again after the current deadline."
  Abort
  deep_focus_inactive:
!macroend

!macro customInit
  !insertmacro deepFocusRejectActive
  nsExec::ExecToLog 'sc.exe stop ${DEEP_FOCUS_SERVICE}'
  Sleep 1500
!macroend

!macro customInstall
  nsExec::ExecToLog 'sc.exe create ${DEEP_FOCUS_SERVICE} binPath= "$\"$INSTDIR\${DEEP_FOCUS_SERVICE_RELATIVE}$\"" start= auto DisplayName= "Deep Focus Blocker"'
  nsExec::ExecToLog 'sc.exe config ${DEEP_FOCUS_SERVICE} binPath= "$\"$INSTDIR\${DEEP_FOCUS_SERVICE_RELATIVE}$\"" start= auto DisplayName= "Deep Focus Blocker"'
  nsExec::ExecToLog 'sc.exe description ${DEEP_FOCUS_SERVICE} "Persists and enforces Deep Focus website deadlines."'
  nsExec::ExecToLog 'sc.exe failure ${DEEP_FOCUS_SERVICE} reset= 86400 actions= restart/5000/restart/15000/restart/60000'
  nsExec::ExecToLog 'sc.exe start ${DEEP_FOCUS_SERVICE}'
!macroend

!macro customUnInstallCheck
  !insertmacro deepFocusRejectActive
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'sc.exe stop ${DEEP_FOCUS_SERVICE}'
  Sleep 1500
  nsExec::ExecToLog '"$INSTDIR\${DEEP_FOCUS_SERVICE_RELATIVE}" --cleanup'
  nsExec::ExecToLog 'sc.exe delete ${DEEP_FOCUS_SERVICE}'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Deep Focus"
!macroend
