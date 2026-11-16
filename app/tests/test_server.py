import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Store, AppError

class FlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name)/'test.sqlite3')
        self.a = self.store.user_for_token(self.store.register('alex@school.edu','Alex','password-for-alex'))
        self.b = self.store.user_for_token(self.store.register('maya@school.edu','Maya','password-for-maya'))
        self.c = self.store.user_for_token(self.store.register('jo@school.edu','Jo','password-for-jo'))
    def tearDown(self): self.temp.cleanup()
    def test_account_login_and_duplicate(self):
        self.assertEqual(self.store.user_for_token(self.store.login('ALEX@SCHOOL.EDU','password-for-alex'))['id'], self.a['id'])
        with self.assertRaises(AppError): self.store.login('alex@school.edu','wrong-password')
        with self.assertRaises(AppError): self.store.register('alex@school.edu','Other','long-password')
    def test_token_lifecycle_and_guards(self):
        sid=self.store.create_session(self.a['id'],'Mathematics','Quadratic equations')
        self.assertEqual(self.store.balance(self.a['id']),0)
        with self.assertRaises(AppError): self.store.complete(self.a['id'],sid)
        self.store.join(self.b['id'],sid)
        self.store.join(self.b['id'],sid)
        self.assertEqual(len(self.store.participants(self.a['id'],sid)),2)
        with self.assertRaises(AppError): self.store.complete(self.b['id'],sid)
        self.store.complete(self.a['id'],sid)
        self.assertEqual((self.store.balance(self.a['id']),self.store.balance(self.b['id'])),(1,1))
        with self.assertRaises(AppError): self.store.complete(self.a['id'],sid)
        with self.assertRaises(AppError): self.store.join(self.c['id'],sid)
        with self.assertRaises(AppError): self.store.thank(self.a['id'],sid,self.c['id'])
        with self.assertRaises(AppError): self.store.thank(self.a['id'],sid,self.a['id'])
        self.store.thank(self.a['id'],sid,self.b['id'])
        self.assertEqual(self.store.balance(self.b['id']),4)
        with self.assertRaises(AppError): self.store.thank(self.a['id'],sid,self.b['id'])
        self.assertEqual(self.store.balance(self.b['id']),4)
        self.assertEqual([e['amount'] for e in self.store.ledger(self.b['id'])],[3,1])

    def test_private_notes_and_multiple_thanks_to_one_helper(self):
        sid=self.store.create_session(self.a['id'],'Science','Cell structure')
        self.store.join(self.b['id'],sid)
        self.store.join(self.c['id'],sid)
        self.store.complete(self.a['id'],sid)
        self.store.thank(self.a['id'],sid,self.b['id'],'You explained the diagram clearly.')
        self.store.thank(self.c['id'],sid,self.b['id'],'Thanks for the example!')
        self.assertEqual(self.store.balance(self.b['id']),7)
        events=self.store.ledger(self.b['id'])
        self.assertEqual([e['note'] for e in events[:2]],['Thanks for the example!','You explained the diagram clearly.'])
        self.assertEqual([e['actor_name'] for e in events[:2]],['Jo','Alex'])
        self.assertFalse(any(e['note'] for e in self.store.ledger(self.a['id'])))
        with self.assertRaises(AppError):
            self.store.thank(self.b['id'],sid,self.a['id'],'x'*241)

    def test_reopening_database_keeps_history(self):
        sid=self.store.create_session(self.a['id'],'English','Essay review')
        self.store.join(self.b['id'],sid)
        self.store.complete(self.a['id'],sid)
        Store(self.store.path)
        self.assertEqual(self.store.balance(self.a['id']),1)
        self.assertEqual(self.store.ledger(self.a['id'])[0]['note'],'')

if __name__=='__main__': unittest.main()
