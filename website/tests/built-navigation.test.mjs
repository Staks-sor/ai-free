import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=new URL('../build/',import.meta.url);
test('all built pages contain localized shared navigation and valid internal links', () => {
  const pages=fs.readdirSync(root,{recursive:true}).filter(p=>p.endsWith('index.html'));
  assert.ok(pages.length>=8);
  for(const file of pages){
    const html=fs.readFileSync(new URL(file,root),'utf8');
    const en=file.startsWith('en/');
    const header=html.match(/<header[\s\S]*?<\/header>/)?.[0] || '';
    assert.ok(header.includes(en?'Instructions':'Инструкция'),file);
    assert.ok(header.includes(en?'Primary navigation':'Основная навигация'),file);
    for(const match of html.matchAll(/href="(\/[^"#?]*)(?:[?#][^"]*)?"/g)){
      const target=decodeURI(match[1]).slice(1);
      assert.ok(fs.existsSync(new URL(target,root)) || fs.existsSync(new URL(path.join(target,'index.html'),root)),file+' → '+target);
    }
  }
});
