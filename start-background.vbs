' qwen-api: launch the proxy hidden and detached.
' The process keeps running after you close this window / the terminal.
' Use status.bat to check it and stop.bat to stop it.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
sh.Run "cmd /c """ & here & "\run-loop.bat""", 0, False
