@echo off
rem Opens Print Studio automatically when you sign in to Windows. Undo with autostart-remove.bat.
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Print Studio.lnk');$s.TargetPath='%~dp0start.bat';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.Save()"
echo Print Studio will start when you sign in.
pause
