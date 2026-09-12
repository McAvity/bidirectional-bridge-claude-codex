"""Bounded native-protocol experiment, not a production launcher or real-agent pilot.
Uses installed Codex with an isolated temporary profile and synthetic localhost provider.
Raw synthetic state remains in a private temporary directory; stdout contains only checks.
"""
import json, os, pathlib, queue, signal, subprocess, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
w7_probe_dir=pathlib.Path(tempfile.mkdtemp(prefix='w7-identity-'))
os.chmod(w7_probe_dir,0o700)
(w7_probe_dir/'home').mkdir(); (w7_probe_dir/'workspace').mkdir()
(w7_probe_dir/'mcp.py').write_text('''import json,os,sys,pathlib
out=pathlib.Path(sys.argv[1])
with out.open('a') as f:f.write(json.dumps({'event':'start','env_present':{k:k in os.environ for k in ['CODEX_THREAD_ID','CODEX_SESSION_ID']}})+'\\n')
for line in sys.stdin:
 try:q=json.loads(line)
 except ValueError:continue
 method=q.get('method')
 if method=='initialize':
  with out.open('a') as f:f.write(json.dumps({'event':'initialize','params':q.get('params')})+'\\n')
  r={'protocolVersion':'2024-11-05','capabilities':{'tools':{}},'serverInfo':{'name':'w7-identity-probe','version':'0'}}
 elif method=='tools/list':r={'tools':[{'name':'identity_probe','description':'Synthetic identity probe','inputSchema':{'type':'object','properties':{'threadId':{'type':'string'}}},'annotations':{'readOnlyHint':True}}]}
 elif method=='tools/call':
  binding=out.with_name('binding.json')
  expected=json.loads(binding.read_text()).get('expected_thread_id') if binding.exists() else None
  actual=q.get('params',{}).get('_meta',{}).get('threadId')
  allowed=isinstance(expected,str) and actual==expected
  with out.open('a') as f:f.write(json.dumps({'event':'call','meta':q.get('params',{}).get('_meta'),'arguments':q.get('params',{}).get('arguments'),'allowed':allowed})+'\\n')
  r={'isError':not allowed,'content':[{'type':'text','text':'synthetic probe allowed' if allowed else 'synthetic probe denied'}]}
 elif method in ['resources/list','resources/templates/list']:r={'resources':[]} if method=='resources/list' else {'resourceTemplates':[]}
 elif method=='ping':r={}
 else:
  if 'id' not in q:continue
  r={}
 if 'id' in q:print(json.dumps({'jsonrpc':'2.0','id':q['id'],'result':r}),flush=True)
''')
http_events=[]
class OfflineProvider(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  names=[t.get('name','') for t in body.get('tools',[]) if t.get('type')=='function']
  ns=next((t for t in body.get('tools',[]) if t.get('type')=='namespace' and 'identity_probe' in t.get('name','')),None)
  name=next((n for n in names if 'identity_probe' in n),None) or ('identity_probe' if ns else None)
  inputs=body.get('input',[])
  last_user=max((i for i,v in enumerate(inputs) if isinstance(v,dict) and v.get('role')=='user'),default=-1)
  has_output=any(i.get('type')=='function_call_output' for i in inputs[last_user+1:] if isinstance(i,dict))
  http_events.append({'tool_available':bool(name),'has_output':has_output})
  if name and not has_output:
   item={'type':'function_call','id':'fc_probe','call_id':'call_probe','name':name,'arguments':json.dumps({'threadId':'argument-is-not-identity'})}
   if ns:item['namespace']=ns['name']
  else:item={'type':'message','id':'msg_probe','role':'assistant','content':[{'type':'output_text','text':'Offline fixture completed.'}]}
  events=[{'type':'response.created','response':{'id':'resp_probe'}},{'type':'response.output_item.done','output_index':0,'item':item},{'type':'response.completed','response':{'id':'resp_probe','status':'completed','output':[item],'usage':{'input_tokens':0,'output_tokens':0,'total_tokens':0}}}]
  wire=''.join('event: '+e['type']+'\ndata: '+json.dumps(e)+'\n\n' for e in events).encode()
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(wire)));self.end_headers();self.wfile.write(wire)
httpd=ThreadingHTTPServer(('127.0.0.1',0),OfflineProvider)
threading.Thread(target=httpd.serve_forever,daemon=True).start()
config='''model = "w7-no-model"
model_provider = "w7_probe"
[model_providers.w7_probe]
name = "Offline identity probe"
base_url = "http://127.0.0.1:PORT/v1"
wire_api = "responses"
requires_openai_auth = false
[mcp_servers.identity_probe]
command = "/usr/bin/python3"
args = %s
startup_timeout_sec = 10
required = true
'''%json.dumps([str(w7_probe_dir/'mcp.py'),str(w7_probe_dir/'mcp.jsonl')])
config=config.replace('PORT',str(httpd.server_port))
(w7_probe_dir/'home/config.toml').write_text(config)
# Child-only documented Codex configuration; parent home/config/runtime unchanged.
child_env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','USER','LOGNAME','SHELL','LANG','TERM']}
child_env.update({'CODEX_HOME':str(w7_probe_dir/'home')})
class Client:
 def __init__(self):
  self.err=(w7_probe_dir/f'stderr-{time.time_ns()}.log').open('w');self.q=queue.Queue();self.n=0;self.notifications=[]
  self.p=subprocess.Popen(['codex','app-server','--listen','stdio://'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.err,text=True,env=child_env,cwd=w7_probe_dir/'workspace',start_new_session=True)
  def read():
   for l in self.p.stdout:
    try:self.q.put(json.loads(l))
    except ValueError:pass
  threading.Thread(target=read,daemon=True).start()
  self.request('initialize',{'clientInfo':{'name':'w7_identity_probe','version':'0'},'capabilities':{'experimentalApi':True}})
  self.send({'method':'initialized','params':{}})
 def send(self,q):self.p.stdin.write(json.dumps(q)+'\n');self.p.stdin.flush()
 def request(self,m,p):
  self.n+=1;n=self.n;self.send({'method':m,'id':n,'params':p});until=time.monotonic()+25
  while time.monotonic()<until:
   q=self.q.get(timeout=max(.1,until-time.monotonic()))
   if q.get('id')==n:
    if 'error' in q:raise RuntimeError(json.dumps(q['error']))
    return q['result']
   self.notifications.append(q)
  raise TimeoutError(m)
 def close(self):
  os.killpg(self.p.pid,signal.SIGTERM)
  try:self.p.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(self.p.pid,signal.SIGKILL);self.p.wait()
  self.err.close()
clients=[];result={}
try:
 c=Client();clients.append(c)
 a=c.request('thread/start',{'cwd':str(w7_probe_dir/'workspace'),'ephemeral':False,'approvalPolicy':'never','sandbox':'read-only'})
 b=c.request('thread/start',{'cwd':str(w7_probe_dir/'workspace'),'ephemeral':False,'approvalPolicy':'never','sandbox':'read-only'})
 result['parallel_thread_ids_distinct']=a['thread']['id']!=b['thread']['id']
 result['root_session_equals_thread']=a['thread'].get('sessionId')==a['thread']['id']
 result['root_source']=a['thread'].get('source')
 # Launcher control channel: derive binding from owned start response, never tool arguments.
 binding=w7_probe_dir/'binding.json'
 fd=os.open(binding,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:json.dump({'expected_thread_id':a['thread']['id']},f)
 def offline_turn(client,tid):
  started=client.request('turn/start',{'threadId':tid,'input':[{'type':'text','text':'Synthetic offline identity fixture.'}]})
  until=time.monotonic()+25
  while time.monotonic()<until:
   event=client.notifications.pop(0) if client.notifications else client.q.get(timeout=25)
   params=event.get('params',{})
   if event.get('method')=='turn/completed' and params.get('threadId')==tid and params.get('turn',{}).get('id')==started['turn']['id']:
    assert params['turn'].get('status')=='completed', 'Offline turn failed'
    return
  raise TimeoutError('offline turn')
 offline_turn(c,a['thread']['id'])
 offline_turn(c,b['thread']['id'])
 resumed=c.request('thread/resume',{'threadId':a['thread']['id']})
 result['live_resume_exact_id']=resumed['thread']['id']==a['thread']['id']
 c.close();clients.remove(c)
 d=Client();clients.append(d)
 try:
  resumed=d.request('thread/resume',{'threadId':a['thread']['id']})
  result['restart_resume_exact_id']=resumed['thread']['id']==a['thread']['id']
  offline_turn(d,a['thread']['id'])
 except Exception as e:result['restart_resume_error']=type(e).__name__
 time.sleep(1)
 events=[json.loads(l) for l in (w7_probe_dir/'mcp.jsonl').read_text().splitlines()]
 result['mcp_starts']=[x for x in events if x['event']=='start']
 inits=[x['params'] for x in events if x['event']=='initialize']
 result['initialize_count']=len(inits)
 result['initialize_top_keys']=[sorted(x) for x in inits]
 result['initialize_has_native_id']=any('threadId' in json.dumps(x) or 'sessionId' in json.dumps(x) for x in inits)
 calls=[e for e in events if e['event']=='call']
 result['native_mcp_calls']=len(calls)
 result['call_thread_sequence_matches_native']=len(calls)==3 and [e['meta'].get('threadId') for e in calls]==[a['thread']['id'],b['thread']['id'],a['thread']['id']]
 result['parallel_threads_not_confused']=len(calls)>=2 and calls[0]['meta'].get('threadId')!=calls[1]['meta'].get('threadId')
 result['resumed_call_preserves_native_id']=len(calls)==3 and calls[0]['meta'].get('threadId')==calls[2]['meta'].get('threadId')
 result['argument_does_not_override_meta']=bool(calls) and all(e['arguments'].get('threadId')!=e['meta'].get('threadId') for e in calls)
 result['offline_provider_requests']=http_events
 result['model_provider']='synthetic localhost HTTP; no real model configured'
 result['network_egress_measured']=False
 result['launcher_binding_allows_only_assigned_root']=len(calls)==3 and [e['allowed'] for e in calls]==[True,False,True]
 result['binding_mode_private']=(binding.stat().st_mode & 0o777)==0o600
 result['probe_version']=subprocess.check_output(['codex','--version'],text=True).strip()
except Exception as e:result['probe_error']=type(e).__name__
finally:
 for c in clients:c.close()
 httpd.shutdown()
# Synthetic sessions only. Do not print native handles or raw wire/stderr.
(w7_probe_dir/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))

assert result.get('call_thread_sequence_matches_native') and result.get('launcher_binding_allows_only_assigned_root') and result.get('restart_resume_exact_id'), 'Native protocol probe did not satisfy its bounded criteria'
