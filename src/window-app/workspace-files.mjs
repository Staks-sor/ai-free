import {executeWorkspaceTool} from '../code-agent/executor.mjs';

// Read-only UI access uses the same canonical workspace boundary as agent tools.
export async function handleWorkspaceFilesRequest(req, res, url, {state, sendJson}) {
  const match = /^\/api\/conversations\/([^/]+)\/files$/.exec(url.pathname);
  if (!match) return false;
  if (req.method !== 'GET') {sendJson(res,{error:'Read-only route'},405);return true;}
  const conversation = state.conversations.find(item=>item.id===match[1]);
  if (!conversation?.workspace) {sendJson(res,{error:'Conversation workspace not found'},404);return true;}
  const file = url.searchParams.get('path');
  try {
    const result = await executeWorkspaceTool(conversation.workspace, file === null
      ? {tool:'list_files',path:'.',maxDepth:4,maxEntries:500}
      : {tool:'read_file',path:file,maxBytes:100_000});
    sendJson(res,result);
  } catch(error) {
    const forbidden = /escapes workspace|Path is blocked|symlink/i.test(error.message);
    sendJson(res,{error:forbidden?'Доступ за пределы проекта или к защищённому файлу запрещён.':error.message},forbidden?403:error.code==='ENOENT'?404:400);
  }
  return true;
}
