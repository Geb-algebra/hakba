import * as vscode from 'vscode';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('hakba-local.hakba');
  assert.ok(extension);await extension.activate();
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const uri = vscode.Uri.file(path.join(root,'links.md'));
  const doc = await vscode.workspace.openTextDocument(uri);await vscode.window.showTextDocument(doc);
  const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider',uri);
  assert.equal(links.length,4);
  assert.ok(links.every(link=>link.target?.scheme === 'command'));
  async function waitForMissing(expected: boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const warnings = vscode.languages.getDiagnostics(uri).filter(item => item.source === 'HAKBa');
      if (warnings.some(item => item.message === 'Link target not found: missing.md') === expected) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Missing-link warning did not become ${expected}`);
  }
  await waitForMissing(true);
  await fs.writeFile(path.join(root, 'missing.md'), '# Created');
  await waitForMissing(false);
  await fs.unlink(path.join(root, 'missing.md'));
  await waitForMissing(true);

  // File-backed documents are deliberately required by the provider.
  const partial = vscode.Uri.file(path.join(root,'partial.md'));await fs.writeFile(partial.fsPath,'[[');
  await vscode.workspace.openTextDocument(partial);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider',partial,new vscode.Position(0,2),'[');
  assert.ok(completions.items.some(item=>item.label === 'data.csv'));
  assert.ok(completions.items.some(item=>item.label === '日本語 空白.md'));
  await vscode.commands.executeCommand('hakba.openLink',uri.fsPath,'日本語 空白.md');
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath,path.join(root,'日本語 空白.md'));
  await vscode.commands.executeCommand('hakba.openLink',uri.fsPath,'data.csv');
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath,path.join(root,'data.csv'));
  await vscode.commands.executeCommand('hakba.openLink',uri.fsPath,'picture.png');
  assert.ok(vscode.window.tabGroups.all.some(group=>group.tabs.some(tab=>tab.label === 'picture.png')));
  await vscode.commands.executeCommand('hakba.openLink',uri.fsPath,'_knowledges/new.md');
  assert.match(await fs.readFile(path.join(root,'_knowledges/new.md'),'utf8'),/draft: true/);
  await vscode.commands.executeCommand('hakba.openLink',uri.fsPath,'missing.csv');
  await assert.rejects(fs.stat(path.join(root,'missing.csv')),{code:'ENOENT'});
  await vscode.commands.executeCommand('hakba.initialize',vscode.Uri.file(root));
  await vscode.commands.executeCommand('hakba.initialize',vscode.Uri.file(root));
  assert.ok((await fs.stat(path.join(root,'_index.md'))).isFile());
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider',uri);
  assert.ok(lenses.some(lens=>lens.command?.title.includes('No Git history')));
  console.log('HAKBa Extension Host integration passed');
}
