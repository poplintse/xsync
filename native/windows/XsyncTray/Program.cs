using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

ApplicationConfiguration.Initialize();
using var app = new XsyncTrayApp();
Application.Run();

sealed class XsyncTrayApp : IDisposable
{
    private readonly NotifyIcon _notifyIcon;
    private readonly string _serverUrl;

    public XsyncTrayApp()
    {
        _serverUrl = Environment.GetEnvironmentVariable("XSYNC_SERVER_URL") ?? "https://xunit.cc/xsync";
        _notifyIcon = new NotifyIcon
        {
            Text = "xsync",
            Icon = SystemIcons.Application,
            Visible = true,
            ContextMenuStrip = BuildMenu()
        };
        _notifyIcon.DoubleClick += (_, _) => OpenConsole();
    }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Authorization", null, (_, _) => OpenAuthorization());
        menu.Items.Add("Open Web Console", null, (_, _) => OpenConsole());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit", null, (_, _) => Application.Exit());
        return menu;
    }

    private void OpenAuthorization()
    {
        var url = $"{_serverUrl.TrimEnd('/')}/device/authorize" +
                  "?device_name=" + Uri.EscapeDataString("Windows Tray") +
                  "&platform=windows" +
                  "&callback_url=" + Uri.EscapeDataString("xsync://device-authorized");
        OpenUrl(url);
    }

    private void OpenConsole()
    {
        OpenUrl(_serverUrl);
    }

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true
        });
    }

    public void Dispose()
    {
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
    }
}
