' Launches its argument with no console window.  wscript hidden-run.vbs "C:\path\to\script.cmd"
Set sh = CreateObject("WScript.Shell")
sh.Run """" & WScript.Arguments(0) & """", 0, False
