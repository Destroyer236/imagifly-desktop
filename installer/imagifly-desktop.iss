; Imagifly Desktop 安装脚本（Inno Setup 6）
; 用法：ISCC.exe /DAppVersion=<版本号> imagifly-desktop.iss
; 依赖：..\imagifly-desktop.exe（先跑 build.ps1）、..\assets\app.ico、ChineseSimplified.isl

#ifndef AppVersion
  #define AppVersion "1.2.17"
#endif

#define AppName "Imagifly Desktop"
#define AppExeName "imagifly-desktop.exe"
#define AppPublisher "Zephyr"
#define AppUrl "https://github.com/Destroyer236/imagifly-desktop"

[Setup]
AppId={{7C4E5A90-3D2B-4E7A-9E11-8A63F1D0C4B8}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
VersionInfoVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
DefaultDirName={autopf}\Imagifly Desktop
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=ImagiflyDesktop-{#AppVersion}-win64-setup
SetupIconFile=..\assets\app.ico
UninstallDisplayIcon={app}\assets\app.ico
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest

[Languages]
Name: "zhcn"; MessagesFile: "ChineseSimplified.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
zhcn.Custom_DesktopIcon=创建桌面快捷方式
en.Custom_DesktopIcon=Create a desktop shortcut
zhcn.Custom_Launch=立即运行 {#AppName}
en.Custom_Launch=Launch {#AppName} now
zhcn.Custom_WebView2=未检测到 Microsoft Edge WebView2 Runtime。程序需要它来显示界面，请从 Microsoft 官网安装后再启动。
en.Custom_WebView2=Microsoft Edge WebView2 Runtime was not found. The app needs it to render its UI; install it from Microsoft before launching.

[Tasks]
Name: "desktopicon"; Description: "{cm:Custom_DesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\imagifly-desktop.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\API-COVERAGE.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\assets\app.ico"; DestDir: "{app}\assets"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\assets\app.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\assets\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:Custom_Launch}"; Flags: nowait postinstall skipifsilent
; 由客户端「更新」页发起的安装：带 /SRC=<安装包路径>，装完后自动把旧安装包删掉
Filename: "{app}\{#AppExeName}"; Parameters: "--cleanup-installer=""{param:SRC}"""; Flags: nowait; Check: HasSourcePackage

[Code]
function HasSourcePackage: Boolean;
begin
  Result := ExpandConstant('{param:SRC|}') <> '';
end;

function WebView2Installed: Boolean;
begin
  Result := DirExists(ExpandConstant('{commonpf32}\Microsoft\EdgeWebView\Application')) or
            DirExists(ExpandConstant('{commonpf}\Microsoft\EdgeWebView\Application'));
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and (not WebView2Installed()) and (not WizardSilent()) then
    SuppressibleMsgBox(CustomMessage('Custom_WebView2'), mbInformation, MB_OK, IDOK);
end;
