"""Exercise production worker methods with fake mailbox/database; no credentials/network."""
import ast
import email
import logging
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.parse import urlencode, parse_qs, urlparse


def worker_class(http=None, mailbox=None):
    tree = ast.parse(Path('cloud/worker.py').read_text())
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef))
    cls.body = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in ('run', 'upsert_recruitment_event')]
    module = ast.Module(body=[cls], type_ignores=[])
    scope = dict(logging=logging, datetime=datetime, email=email, urlencode=urlencode,
                 httpx=http, imaplib=SimpleNamespace(IMAP4_SSL=lambda _: mailbox))
    exec(compile(module, 'cloud/worker.py', 'exec'), scope)
    worker = scope['CloudSyncWorker']()
    worker.supabase_url = 'https://example.invalid'
    worker.sb_headers = {}
    return worker


class Response:
    def __init__(self, data, code=200):
        self.data, self.status_code, self.text = data, code, 'simulated'
    def json(self): return self.data
    def raise_for_status(self):
        if self.status_code >= 400: raise RuntimeError('database unavailable')


class SyncTests(unittest.TestCase):
    def run_mailbox(self, fail_uid=None, unreadable=None):
        mailbox = Mock()
        def uid(command, *args):
            if command == 'search': return 'OK', [b'13 11 12']
            num = int(args[0])
            if 'HEADER' in args[1]: return 'OK', [(b'', b'Subject: test\n')]
            if num == unreadable: return 'NO', []
            return 'OK', [(b'', f'Subject: test\n\n{num}'.encode())]
        mailbox.uid.side_effect = uid
        w = worker_class(mailbox=mailbox)
        w.imap_server = w.email_addr = w.auth_code = 'fake'
        w.get_sync_state = lambda: 10
        w.update_sync_state = Mock()
        w.decode_str = lambda x: x
        w.parse_email_content = lambda msg: msg.get_payload()
        w.parse_with_ai = lambda subject, body: {'is_recruitment': True}
        w.upsert_recruitment_event = Mock(side_effect=lambda data, uid, subject: int(uid) != fail_uid)
        w.run()
        return w

    def test_write_failure_stops_at_contiguous_success(self):
        w = self.run_mailbox(fail_uid=12)
        w.update_sync_state.assert_called_once_with(11)
        self.assertEqual([c.args[1] for c in w.upsert_recruitment_event.call_args_list], ['11', '12'])

    def test_fetch_failure_does_not_skip_email(self):
        w = self.run_mailbox(unreadable=12)
        w.update_sync_state.assert_called_once_with(11)

    def test_first_failure_does_not_advance(self):
        w = self.run_mailbox(fail_uid=11)
        w.update_sync_state.assert_not_called()

    def test_offered_application_reused_without_changing_confirmed_snapshot(self):
        http = Mock()
        http.get.side_effect = [Response([]), Response([{'id':'a'}]), Response([{'seq':3}])]
        http.post.return_value = Response([],201)
        w = worker_class(http=http)
        self.assertTrue(w.upsert_recruitment_event({'company':'A&B', 'position':'研发+测试', 'stage_name':'入职通知'}, '1', '通知'))
        query = parse_qs(urlparse(http.get.call_args_list[1].args[0]).query)
        self.assertEqual(query['company'], ['eq.A&B'])
        self.assertEqual(query['position'], ['eq.研发+测试'])
        self.assertEqual(query['overall_status'], ['in.(active,offered)'])
        http.patch.assert_not_called()
        self.assertEqual(http.post.call_args.kwargs['json']['stage_status'], 'pending')

    def test_database_lookup_failure_never_creates_duplicate(self):
        http=Mock(); http.get.side_effect=[Response([]),Response([],503)]
        w=worker_class(http=http)
        self.assertFalse(w.upsert_recruitment_event({'company':'A'}, '1','通知'))
        http.post.assert_not_called()

    def test_ambiguous_match_requires_review(self):
        http=Mock(); http.get.side_effect=[Response([]),Response([{'id':'a'},{'id':'b'}])]
        w=worker_class(http=http)
        self.assertFalse(w.upsert_recruitment_event({'company':'A'}, '1','通知'))
        http.post.assert_not_called()

if __name__ == '__main__': unittest.main()
