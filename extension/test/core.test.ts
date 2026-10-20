import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {parse} from 'yaml';
import * as core from '../src/core';
async function fixture(fn:(root:string)=>Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'hakba-'));
  try {await core.git(root,['init','-b','main']);await core.git(root,['config','user.email','test@example.invalid']);await core.git(root,['config','user.name','Test']);await fn(root);}
  finally {await fs.rm(root,{recursive:true,force:true});}
}
test('wiki links preserve paths and aliases; ignore fenced, inline and indented code', () => {
  const text = '[[日本語 空白/a.md|表示]] [[data.csv]] [[image.png]]\n`[[hidden.md]]`\n```md\n[[hidden2.md]]\n```\n~~~\n[[hidden3.md]]\n~~~\n    [[hidden4.md]]\n[[visible.md]]';
  assert.deepEqual(core.links(text).map(x=>x.target),['日本語 空白/a.md','data.csv','image.png','visible.md']);
  for (const link of core.links(text)) assert.ok(text.slice(link.start,link.end).startsWith('[['));
  assert.equal(core.completionAt('[[日本語/',6)?.prefix,'日本語/');
  assert.equal(core.completionAt('`[[x]]`',4),undefined);
  assert.equal(core.completionAt('[[x|label',9),undefined);
});
test('code inside blockquotes and lists, and exact inline delimiter lengths', () => {
  const text = '> ```\n> [[hidden.md]]\n> ```\n\n- item\n\n      [[indented.md]]\n\n`` outer ` [[inline.md]] `` [[visible.md]]';
  assert.deepEqual(core.links(text).map(link => link.target), ['visible.md']);
  assert.deepEqual(core.links('unclosed `\n\n[[visible.md]]\n\nclosing `').map(link=>link.target),['visible.md']);
});
test('safe creation, nested classification, no overwrites, no traversal or symlink escapes', async () => fixture(async root => {
  await core.initializeSpace(root);
  const original = await fs.readFile(path.join(root,'_index.md'),'utf8');
  await core.initializeSpace(root);
  assert.equal(await fs.readFile(path.join(root,'_index.md'),'utf8'),original);
  const file = await core.createMarkdown(root,'_knowledges/日本語 空白/nested.md');
  assert.match(await fs.readFile(file,'utf8'),/draft: true/);
  await assert.rejects(core.createMarkdown(root,'_knowledges/日本語 空白/nested.md'),{code:'EEXIST'});
  for (const target of ['../escape.md','/tmp/escape.md','.git/config','a/../../escape.md','image.png']) await assert.rejects(core.createMarkdown(root,target));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(),'hakba-outside-'));
  try {await fs.symlink(outside,path.join(root,'escape'));await assert.rejects(core.createMarkdown(root,'escape/file.md'));}
  finally {await fs.rm(outside,{recursive:true,force:true});}
  const child = path.join(root,'261018_child');await core.initializeSpace(child);
  assert.equal(await core.nearestSpace(root,path.join(root,'_knowledges')),root);
  assert.equal(await core.nearestSpace(root,child),child);
  assert.equal(core.datePrefix(new Date(2026,9,18)),'261018_');
}));
test('approval preserves metadata and body including CRLF; rejects broken YAML', () => {
  const text = '---\r\ntitle: Example\r\ndraft: true\r\ntags: [a, b]\r\n---\r\n# Body\r\n';
  const approved = core.approve(text);
  assert.ok(approved.endsWith('# Body\r\n'));
  const metadata = parse(approved.split('---')[1]);
  assert.deepEqual(metadata,{title:'Example',draft:false,tags:['a','b']});
  assert.match(core.approve('# New\n'),/draft: false/);
  assert.equal(parse(core.approve('---\n---\nBody').split('---')[1]).draft,false);
  assert.throws(()=>core.approve('---\ndraft: true\ndraft: false\n---\nBody'));
  assert.throws(()=>core.approve('---\ndraft: [\n---\nBody'));
  assert.throws(()=>core.approve('---\ndraft: true'));
  assert.equal(parse(core.approve('---\n"draft": true\n---\nBody').split('---')[1]).draft,false);
});
test('file candidates include untracked and arbitrary formats; respect gitignore', async () => fixture(async root => {
  await fs.writeFile(path.join(root,'.gitignore'),'ignored/\n');
  await fs.writeFile(path.join(root,'tracked.md'),'');await core.git(root,['add','tracked.md']);await fs.appendFile(path.join(root,'.gitignore'),'tracked.md\n');
  await fs.writeFile(path.join(root,'deleted.md'),'');await core.git(root,['add','deleted.md']);await fs.unlink(path.join(root,'deleted.md'));
  await fs.mkdir(path.join(root,'ignored'));await fs.writeFile(path.join(root,'ignored','no.md'),'');
  for (const name of ['日本語 空白.md','data.csv','image.png']) await fs.writeFile(path.join(root,name),'');
  assert.deepEqual(await core.files(root),['.gitignore','data.csv','image.png','日本語 空白.md']);
}));
test('git dates follow renames and ignore uncommitted edits; shallow is marked', async () => fixture(async root => {
  const file = path.join(root,'old.md');await fs.writeFile(file,'one');
  assert.equal((await core.dates(root,file)).created,undefined);
  await core.git(root,['add','.']);await core.git(root,['-c','user.useConfigOnly=true','commit','-m','first']);
  const first = await core.dates(root,file);
  await core.git(root,['mv','old.md','new.md']);await core.git(root,['commit','-m','rename']);
  const renamed = path.join(root,'new.md');const result = await core.dates(root,renamed);
  assert.equal(result.created,first.created);assert.ok(result.updated);assert.equal(result.shallow,false);
  await fs.writeFile(renamed,'uncommitted');assert.deepEqual(await core.dates(root,renamed),result);
  const clone = await fs.mkdtemp(path.join(os.tmpdir(),'hakba-clone-'));
  try {await core.git(clone,['clone','--depth=1',`file://${root}`,'.']);assert.equal((await core.dates(clone,path.join(clone,'new.md'))).shallow,true);}
  finally {await fs.rm(clone,{recursive:true,force:true});}
}));
test('dated classified filenames preserve subdirectories and existing dates', () => {
  const date = new Date(2026,9,20);
  for (const kind of ['_sources','_outputs'] as const) {
    assert.equal(core.classifiedFilename('nested/report',kind,date),'nested/261020_report.md');
    assert.equal(core.classifiedFilename('nested/261018_report.md',kind,date),'nested/261018_report.md');
  }
  for (const kind of ['_contexts','_knowledges'] as const)
    assert.equal(core.classifiedFilename('nested/report',kind,date),'nested/report.md');
});
test('shared link prefixes respect directory boundaries and alias ranges', () => {
  const root = path.resolve('/repo');
  const origin = path.join(root,'project','_knowledges','note.md');
  for (const [target,prefix] of [
    ['project/_knowledges/other.md','project/_knowledges/'],
    ['project/_sources/data.csv','project/'],
    ['project/nested/deep/file.md','project/'],
    ['projects/file.md',''], ['other/file.md',''], ['root.md','']
  ]) assert.equal(target.slice(0,core.sharedLinkPrefix(root,origin,target)),prefix);
  assert.equal(core.sharedLinkPrefix(root,path.join(root,'note.md'),'project/file.md'),0);
  const text = '[[project/_sources/data.csv|データ]]';
  const link = core.links(text)[0];
  assert.equal(text.slice(link.start+2,link.start+2+core.sharedLinkPrefix(root,origin,link.target)),'project/');
});

test('ancestor choices include distant Spaces, skip ordinary directories and exclude siblings', async () => fixture(async root => {
  await core.initializeSpace(root);
  const parent = path.join(root,'company');
  const grandchild = path.join(parent,'ordinary','project');
  const current = path.join(grandchild,'design');
  for (const dir of [parent,grandchild,current,path.join(root,'sibling')]) await core.initializeSpace(dir);
  assert.deepEqual(await core.ancestorSpaces(root,path.join(current,'_knowledges')), [root,parent,grandchild,current]);
  assert.deepEqual(await core.ancestorSpaces(root,root), [root]);
}));
