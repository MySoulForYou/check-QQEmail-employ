"""Self-contained macOS worker; the AppleScript app retains double-click toggle."""
import sys


def self_test():
    # Exercise dynamically loaded Cocoa dependencies without opening a window.
    import AppKit
    import Quartz
    import WebKit
    import webview
    from webview.platforms import cocoa
    from server import app

    with app.test_client() as client:
        for path in ('/', '/admin/app.js', '/admin/style.css', '/admin/supabase.js',
                     '/widget', '/widget/drag.js', '/widget/app.js', '/widget/style.css', '/widget/supabase.js'):
            response = client.get(path)
            if response.status_code != 200 or not response.data:
                raise RuntimeError(f'Missing bundled resource: {path}')
    print('OfferPilot runtime self-test passed (Python, Cocoa, Flask, static assets).')


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        self_test()
    else:
        from main import start_app
        start_app()
