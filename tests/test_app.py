import json, os, tempfile, threading, unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import app

class AppTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.original=(app.DATA,app.DB)
        app.DATA=Path(self.temp.name);app.DB=app.DATA/'test.sqlite3';app.initialize()
        self.server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url=f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
        app.DATA,app.DB=self.original;self.temp.cleanup()
    def request(self,path,data=None,headers=None):
        head={'Content-Type':'application/json','X-TaskNest':'1',**(headers or {})}
        req=Request(self.url+path,data=None if data is None else json.dumps(data).encode(),headers=head)
        try:
            with urlopen(req) as r:return r.status,json.load(r)
        except HTTPError as e:return e.code,json.load(e)
    def create(self,**kw):
        code,result=self.request('/api/task',{'title':'Test login','estimate':1,**kw})
        self.assertEqual(code,200,result);return result['id']
    def count(self,title):
        with app.db() as c:return c.execute('SELECT COUNT(*) FROM notifications WHERE title=?',(title,)).fetchone()[0]
    def test_selected_only_and_idempotent_approval(self):
        self.request('/api/notes',{'body':'Test login.\nUpdate docs.\nMaybe a party someday.','use_ai':False})
        state=self.request('/api/state')[1];self.assertEqual(state['tasks'],[])
        n=state['notes'][0];self.assertEqual(len(n['suggestions']),2)
        payload={'note_id':n['id'],'tasks':[n['suggestions'][0]]}
        self.assertEqual(self.request('/api/approve',payload)[1]['created'],1)
        self.assertEqual(self.request('/api/approve',payload)[1]['created'],0)
        self.assertEqual(len(self.request('/api/state')[1]['tasks']),1)
    def test_atomic_approval(self):
        self.request('/api/notes',{'body':'Test login. Update docs.'})
        n=self.request('/api/state')[1]['notes'][0]
        tasks=[n['suggestions'][0],{**n['suggestions'][1],'title':''}]
        self.assertEqual(self.request('/api/approve',{'note_id':n['id'],'tasks':tasks})[0],400)
        self.assertEqual(self.request('/api/state')[1]['tasks'],[])
    def test_due_dedup_completed_suppression(self):
        ident=self.create(due=100);app.tick(101);app.tick(102)
        self.assertEqual(self.count('Task overdue'),1)
        self.request('/api/task',{'id':ident,'title':'Test login','due':99,'status':'completed'})
        app.tick(103);self.assertEqual(self.count('Task overdue'),1)
    def test_estimate_is_not_deadline(self):
        self.create();app.tick(100000)
        self.assertEqual(self.count('Time for a check-in'),0)
    def test_timer_pause_and_effort(self):
        ident=self.create()
        with patch('app.now',return_value=100):self.request('/api/timer',{'id':ident,'action':'start'})
        app.tick(161);app.tick(162);self.assertEqual(self.count('Time for a check-in'),1)
        with patch('app.now',return_value=170):self.request('/api/timer',{'id':ident,'action':'pause'})
        t=self.request('/api/state')[1]['tasks'][0];self.assertEqual(t['elapsed'],70);self.assertIsNone(t['running_since'])
    def test_snooze_rearms(self):
        ident=self.create(due=100);app.tick(101)
        with patch('app.now',return_value=102):self.request('/api/snooze',{'id':ident,'minutes':1})
        app.tick(150);app.tick(163);app.tick(164);self.assertEqual(self.count('Task overdue'),2)
    def test_daily_digest_dedup(self):
        with app.db() as c:c.execute('UPDATE settings SET value=?',(json.dumps({**app.DEFAULTS,'timezone':'UTC','daily_time':'00:00'}),))
        app.tick(1700000000);app.tick(1700000001);self.assertEqual(self.count('Your daily task summary'),1)
    def test_validation_and_origin(self):
        self.assertEqual(self.request('/api/task',{'title':'','estimate':-1})[0],400)
        self.assertEqual(self.request('/api/task',{'title':'bad'},{'Origin':'https://example.com'})[0],403)
        self.assertEqual(self.request('/api/task',{'title':'bad'},{'X-TaskNest':'0'})[0],403)
        self.assertEqual(self.request('/api/state',headers={'Host':'evil.example'})[0],403)
    def test_persistence_and_subtasks(self):
        self.create(subtasks=[{'title':'Expired session','done':True}]);app.initialize()
        self.assertTrue(self.request('/api/state')[1]['tasks'][0]['subtasks'][0]['done'])
    def test_ai_contract_evidence(self):
        raw={'summary':'Login work','tasks':[{'title':'Test login','evidence':'Test login','subtasks':[]}]}
        with patch('app.ai_request',return_value={'choices':[{'message':{'content':json.dumps(raw)}}]}):
            result,mode=app.extract('Test login',True);self.assertEqual(mode,'ai');self.assertIsNone(result['tasks'][0]['due'])
            with self.assertRaises(ValueError):app.extract('Unrelated text',True)
    def test_transcription_multipart(self):
        with patch('app.ai_request',return_value={'text':'Test login'}) as call:
            self.assertEqual(app.transcribe(b'fake-audio','audio/webm;codecs=opus'),'Test login')
            self.assertIn(b'fake-audio',call.call_args.args[1]);self.assertEqual(call.call_args.args[0],'/audio/transcriptions')
    def test_email_disabled(self):
        with patch('app.smtplib.SMTP') as smtp,patch.dict(os.environ,{'SMTP_HOST':'example.com'}):
            app.tick(1700000000);app.send_emails();smtp.assert_not_called()
    def test_email_sent_once(self):
        with app.db() as c:
            c.execute('UPDATE settings SET value=?',(json.dumps({**app.DEFAULTS,'email_enabled':True,'email':'owner@example.com'}),))
            app.emit(c,'test','Reminder','Test login',app.now())
        with patch.dict(os.environ,{'SMTP_HOST':'smtp.example.com','SMTP_FROM':'app@example.com'}),patch('app.smtplib.SMTP') as smtp:
            app.send_emails();app.send_emails();self.assertEqual(smtp.return_value.__enter__.return_value.send_message.call_count,1)

if __name__=='__main__':unittest.main()
