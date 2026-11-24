export function getWorkspaceProjects(state) {
  const paths = [...new Set([state.workspaceRoot, ...(state.conversations || []).map(c=>c.workspace)].filter(Boolean))];
  return paths.map(path=>({path,name:String(path).split(/[\\/]/).filter(Boolean).pop()||path}));
}

export function getWorkspaceBoardItems(state, workspace, query='') {
  const running = new Set(state.runningTaskIds || []), items=[];
  for (const conversation of state.conversations || []) {
    if (workspace && conversation.workspace !== workspace) continue;
    const views = [conversation.taskView, ...(conversation.taskHistoryView || [])].filter(Boolean);
    for (const [index, original] of views.entries()) {
      const current = index===0 && Boolean(conversation.taskView);
      const busy = current && (running.has(conversation.id) || original.canStop);
      const view = {...original,canStop:busy,canResume:current && !busy && original.canResume===true};
      const column = busy ? 'working' : ['created','queued'].includes(view.status) ? 'queue'
        : view.status==='completed' ? 'done' : 'help';
      if (query && ![conversation.title,view.goal,conversation.provider].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
      items.push({conversation,view,column,current});
    }
  }
  return items;
}

export function setupWorkspaceSidebar() {
  const byId=id=>document.getElementById(id);
  const read=key=>{try{return localStorage.getItem(key)==='1';}catch{return false;}};
  const save=(key,value)=>{try{localStorage.setItem(key,value?'1':'0');}catch{}};
  const mobile=()=>matchMedia('(max-width:760px)').matches;
  const apply=collapsed=>{
    document.body.classList.toggle('workspaceSidebarCollapsed',collapsed);
    byId('workspaceMobileMenu').setAttribute('aria-expanded',String(!collapsed));
  };
  apply(read('synvox.sidebarCollapsed'));
  byId('workspaceMobileMenu').addEventListener('click',()=>{
    if(mobile()){
      const open=!document.body.classList.contains('workspaceSidebarOpen');
      document.body.classList.toggle('workspaceSidebarOpen',open);
      byId('workspaceMobileMenu').setAttribute('aria-expanded',String(open));
    }else{
      const collapsed=!document.body.classList.contains('workspaceSidebarCollapsed');
      apply(collapsed);save('synvox.sidebarCollapsed',collapsed);
    }
  });
  byId('workspaceSidebarCollapse').addEventListener('click',()=>{
    if(mobile())document.body.classList.toggle('workspaceSidebarOpen',false);
    else{apply(true);save('synvox.sidebarCollapsed',true);}
    byId('workspaceMobileMenu').setAttribute('aria-expanded','false');
    byId('workspaceMobileMenu').focus();
  });
  const menu=byId('workspaceFooterMenu');
  menu.open=read('synvox.sidebarMoreOpen');
  menu.addEventListener('toggle',()=>save('synvox.sidebarMoreOpen',menu.open));
  if(mobile())byId('workspaceMobileMenu').setAttribute('aria-expanded','false');
}

// This function is embedded in the existing app script. It adds no AI client or timer.
export function setupWorkspaceUi({getState,getConversation,getTaskView,getBoardItems,getProjects,api,loadConversation,
  onContinue,onStop,openNewChat,patchConversation,onError,t}) {
  const byId=id=>document.getElementById(id);
  const label=(ru,en)=>document.documentElement.lang==='ru'?ru:en;
  const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
  const action=(text,run,className='iconBtn')=>{const b=el('button',className,text);b.type='button';b.addEventListener('click',()=>Promise.resolve(run(b)).catch(error=>onError(error.message)));return b;};
  let tab='chat',selectedProject=null,selectedTask=null,fileRequest=0,filesContext=null,filesLoading=null;
  const board=byId('workspaceBoard'),inspector=byId('workspaceInspector'),files=byId('workspaceFiles');
  const workspace=()=>selectedProject||getConversation()?.workspace||getState().workspaceRoot||'';
  const scopeItems=()=>getBoardItems(getState(),workspace(),byId('workspaceTaskSearch').value);
  function selectTab(next){tab=next;document.body.dataset.workspaceTab=next;for(const b of document.querySelectorAll('button[data-workspace-tab]')){b.classList.toggle('active',b.dataset.workspaceTab===next);b.setAttribute('aria-selected',String(b.dataset.workspaceTab===next));}update();if(next==='files')loadFiles().catch(error=>onError(error.message));}
  function badge(view){const n=el('span','taskStatus',t('tasks.status.'+view.status));n.dataset.status=view.status;return n;}
  function controls(item,container){if(item.view.canStop)container.appendChild(action(t('tasks.stop'),button=>onStop(item.conversation.id,button)));
    else if(item.current && ['paused','interrupted','failed','cancelled'].includes(item.view.status)){const b=action(t('tasks.continue'),button=>onContinue(item.conversation.id,item.view.id,button));b.disabled=!item.view.canResume;container.appendChild(b);}}
  function evidence(view,parent){
    const verification=el('p','taskVerification',t('tasks.verification.'+view.verification));verification.dataset.result=view.verification;parent.appendChild(verification);
    if(view.checks?.length){const list=el('ul','workspaceChecks');for(const check of view.checks){const li=el('li','',(check.ok?'✓ ':'✗ ')+check.name+' · exit '+(check.status??'?'));li.dataset.passed=String(check.ok);list.appendChild(li)}parent.appendChild(list);}
    if(view.changedFiles?.length){const details=el('details','workspaceChangedFiles');details.appendChild(el('summary','',label('Изменённые файлы','Changed files')+' · '+view.changedFiles.length));for(const file of view.changedFiles)details.appendChild(el('div','workspaceFileName',file));parent.appendChild(details);}
  }
  function plan(view,parent){const steps=view.plan||[];if(!steps.length){parent.appendChild(el('p','taskMeta',label('План пока не задан. Здесь появятся шаги, которые сохранит AI.','No plan yet. Steps saved by the AI will appear here.')));return;}
    const done=steps.filter(s=>s.status==='completed').length;parent.appendChild(el('p','taskMeta',done+' / '+steps.length+' '+label('шагов','steps')));
    const progress=el('progress','workspaceTaskProgress');progress.max=steps.length;progress.value=done;progress.setAttribute('aria-label',label('Завершённые шаги','Completed steps'));parent.appendChild(progress);
    const list=el('ol','workspacePlan');for(const step of steps){const li=el('li','',step.title);li.dataset.status=step.status;const state=el('span','taskMeta',label(({pending:'Ожидает',in_progress:'В работе',completed:'Выполнен'})[step.status],({pending:'Pending',in_progress:'In progress',completed:'Completed'})[step.status]));li.appendChild(state);list.appendChild(li)}parent.appendChild(list);
  }
  function renderInspector(){inspector.replaceChildren();const head=el('div','workspaceInspectorHead');head.append(el('h2','',label('Ход работы','Task progress')),action('×',()=>{document.body.classList.add('workspaceInspectorClosed');document.body.classList.remove('workspaceInspectorOpenMobile');byId('workspaceInspectorToggle').setAttribute('aria-expanded','false')},'iconBtn'));head.lastChild.setAttribute('aria-label',label('Скрыть ход работы','Hide task progress'));inspector.appendChild(head);
    const items=getBoardItems(getState(),workspace());let item=selectedTask&&items.find(i=>i.view.id===selectedTask);const active=getConversation();if(!item)item=items.find(i=>i.current&&i.conversation.id===active?.id);
    if(!item&&active?.harnessTask&&active.workspace===workspace())item={conversation:active,view:getTaskView(active,{running:(getState().runningTaskIds||[]).includes(active.id)}),current:true};
    if(!item?.view){inspector.appendChild(el('p','workspaceInspectorEmpty',label('Отправьте задачу в режиме «Выполнить». Здесь появятся её состояние, шаги и проверки.','Send a task in Execute mode to see its state, steps, and checks.')));return;}
    const section=el('section','workspaceInspectorSection');section.append(badge(item.view),el('h3','',item.view.goal));
    const phases={awaiting_model:label('AI выбирает следующий шаг','AI is choosing the next step'),executing_tool:label('Выполняется инструмент','Running a tool'),ready:label('Результат инструмента сохранён','Tool result saved')};
    if(item.view.phase)section.appendChild(el('p','taskMeta',phases[item.view.phase]+(item.view.currentTool?' · '+item.view.currentTool:'')));
    plan(item.view,section);const actions=el('div','taskActions');controls(item,actions);actions.appendChild(action(t('tasks.open'),async()=>{selectedTask=null;await loadConversation(item.conversation.id);selectTab('chat')}));section.appendChild(actions);
    if(item.view.resumeReason && !item.view.canStop && item.view.status!=='completed')section.appendChild(el('p','taskMeta',t('tasks.reason.'+item.view.resumeReason)));
    inspector.appendChild(section);const checks=el('section','workspaceInspectorSection');checks.appendChild(el('h3','',label('Результат и проверки','Result and checks')));evidence(item.view,checks);inspector.appendChild(checks);
  }
  function renderBoard(){const columns=byId('workspaceBoardColumns');columns.replaceChildren();const items=scopeItems();
    for(const [key,name] of [['queue',label('Очередь','Queue')],['working',label('В работе','Working')],['help',label('Нужна помощь','Needs attention')],['done',label('Завершено','Completed')]]){const col=el('section','workspaceBoardColumn');col.dataset.column=key;const group=items.filter(i=>i.column===key);col.appendChild(el('h2','',name+' · '+group.length));
      for(const item of group){const card=el('article','workspaceTaskCard');card.dataset.taskId=item.view.id;card.append(badge(item.view),el('h3','',item.view.goal||item.conversation.title),el('p','taskMeta',[item.conversation.provider,item.conversation.model].filter(Boolean).join(' · ')));
        if(item.view.plan?.length){const count=item.view.plan.filter(s=>s.status==='completed').length;card.appendChild(el('p','taskMeta',count+' / '+item.view.plan.length+' '+label('шагов','steps')))}
        evidence(item.view,card);const actions=el('div','taskActions');const open=action(label('Подробнее','Details'),()=>{selectedTask=item.view.id;selectTab('chat');document.body.classList.remove('workspaceInspectorClosed');if(matchMedia('(max-width: 1000px)').matches)document.body.classList.add('workspaceInspectorOpenMobile')});actions.appendChild(open);controls(item,actions);card.appendChild(actions);col.appendChild(card)}
      if(!group.length)col.appendChild(el('p','taskMeta',label('Пока нет задач','No tasks yet')));columns.appendChild(col);
    }
  }
  function update(){const state=getState(),active=getConversation();if(active?.workspace&&selectedProject&&selectedProject!==active.workspace&&!state.conversations.some(c=>c.workspace===selectedProject))selectedProject=null;
    const projects=byId('workspaceProjectList');projects.replaceChildren();for(const p of getProjects(state)){const b=action(p.name,async()=>{const first=state.conversations.find(c=>c.workspace===p.path);if(!first){await openNewChat(p.path);return;}selectedProject=p.path;selectedTask=null;filesContext=null;fileRequest++;await loadConversation(first.id);update();if(tab==='files')await loadFiles()},'workspaceProjectButton');b.title=p.path;b.classList.toggle('active',p.path===workspace());projects.appendChild(b)}
    for(const chat of byId('chatList').children){const summary=state.conversations.find(c=>c.id===chat.dataset.conversationId);if(summary)chat.hidden=Boolean(workspace()&&summary.workspace!==workspace())}
    byId('workspaceProjectName').textContent=String(workspace()).split(/[\\/]/).filter(Boolean).pop()||label('Без проекта','No project');byId('workspaceProjectName').title=workspace();
    byId('workspaceTaskCount').textContent=getBoardItems(state,workspace()).filter(i=>i.column!=='done').length;
    for(const id of ['workspaceDiscuss','workspaceExecute']){const b=byId(id);const execute=active?.interactionMode!=='discuss';b.classList.toggle('active',id==='workspaceExecute'?execute:!execute);b.setAttribute('aria-pressed',String(id==='workspaceExecute'?execute:!execute));b.disabled=!active||(state.runningTaskIds||[]).includes(active.id)}
    const accessModePicker=byId('accessModePicker');accessModePicker.value=active?.accessMode==='computer'?'computer':'project';accessModePicker.disabled=!active||(state.runningTaskIds||[]).includes(active.id);
    renderInspector();if(tab==='tasks')renderBoard();
    if(tab==='files'){const c=filesConversation();if(c?.id!==filesContext&&c?.id!==filesLoading)loadFiles().catch(error=>onError(error.message));}
  }
  function filesConversation(){const state=getState(),active=getConversation();return active?.workspace===workspace()?active:state.conversations.find(c=>c.workspace===workspace());}
  async function loadFiles(){const context=filesConversation(),request=++fileRequest;const tree=byId('workspaceFileTree'),preview=byId('workspaceFilePreview');tree.replaceChildren();preview.textContent=label('Выберите файл для чтения.','Choose a file to read.');if(!context){filesContext=null;filesLoading=null;tree.appendChild(el('p','taskMeta',label('Сначала создайте чат в этом проекте.','Create a chat in this project first.')));return;}
    filesLoading=context.id;tree.appendChild(el('p','taskMeta',t('app.loading')));
    try{const data=await api('/api/conversations/'+encodeURIComponent(context.id)+'/files');if(request!==fileRequest)return;tree.replaceChildren();filesContext=context.id;
      for(const file of data.entries||[]){if(file.endsWith('/')){tree.appendChild(el('div','workspaceFileDirectory',file));continue;}const b=action(file,async()=>{const readRequest=++fileRequest;preview.textContent=t('app.loading');try{const data=await api('/api/conversations/'+encodeURIComponent(context.id)+'/files?path='+encodeURIComponent(file));if(readRequest!==fileRequest)return;preview.textContent=data.content+(data.truncated?'\n\n'+label('Показаны первые 100 КБ.','First 100 KB shown.'):'');byId('workspaceFileName').textContent=file;}catch(error){if(readRequest===fileRequest)preview.textContent=error.message}},'workspaceFileButton');tree.appendChild(b)}
      if(data.truncated)tree.appendChild(el('p','taskMeta',label('Список ограничен 500 записями и глубиной 4.','List limited to 500 entries and depth 4.')));
    }catch(error){if(request===fileRequest){tree.replaceChildren(el('p','taskMeta',error.message));filesContext=context.id;}}finally{if(filesLoading===context.id)filesLoading=null;}
  }
  for(const b of document.querySelectorAll('button[data-workspace-tab]'))b.addEventListener('click',()=>selectTab(b.dataset.workspaceTab));
  byId('workspaceTaskSearch').addEventListener('input',renderBoard);byId('workspaceBoardNew').addEventListener('click',()=>openNewChat(workspace()).catch(e=>onError(e.message)));
  byId('workspaceFilesRefresh').addEventListener('click',()=>loadFiles().catch(e=>onError(e.message)));
  byId('workspaceInspectorToggle').addEventListener('click',()=>{const mobile=matchMedia('(max-width:1000px)').matches;let open;if(mobile){open=!document.body.classList.contains('workspaceInspectorOpenMobile');document.body.classList.toggle('workspaceInspectorOpenMobile',open);document.body.classList.toggle('workspaceInspectorClosed',!open)}else{open=document.body.classList.contains('workspaceInspectorClosed');document.body.classList.toggle('workspaceInspectorClosed',!open)}byId('workspaceInspectorToggle').setAttribute('aria-expanded',String(open));selectTab('chat')});
  for(const [id,mode] of [['workspaceDiscuss','discuss'],['workspaceExecute','execute']])byId(id).addEventListener('click',async()=>{byId(id).disabled=true;try{await patchConversation({interactionMode:mode});update()}catch(error){onError(error.message);update()}});
  byId('accessModePicker').addEventListener('change',async event=>{const picker=event.currentTarget;picker.disabled=true;try{await patchConversation({accessMode:picker.value});update()}catch(error){onError(error.message);update()}});
  selectTab('chat');return {update,selectTab,conversationChanged(){selectedProject=getConversation()?.workspace||null;selectedTask=null;document.body.classList.remove('workspaceSidebarOpen');update();}};
}
