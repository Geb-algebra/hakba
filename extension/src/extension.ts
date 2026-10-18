import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as core from './core';
const markdown = {language:'markdown', scheme:'file'};
export function activate(context: vscode.ExtensionContext): void {
  const events = new vscode.EventEmitter<void>();
  const dateCache = new Map<string, Promise<core.GitDates>>();
  const diagnostics = vscode.languages.createDiagnosticCollection('hakba');
  const missingLinkStyle = vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor('editorWarning.foreground')
  });
  let linkRevision = 0;
  async function refreshLinks(): Promise<void> {
    const revision = ++linkRevision;
    await Promise.all(vscode.window.visibleTextEditors.map(async editor => {
      const document = editor.document;
      if (document.languageId !== 'markdown' || document.uri.scheme !== 'file') return;
      const version = document.version;
      const missing: vscode.Diagnostic[] = [];
      try {
        const root = await core.repository(document.uri.fsPath);
        await Promise.all(core.links(document.getText()).map(async link => {
          try {
            const file = await core.resolveTarget(root, link.target);
            await fs.stat(file);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
            const range = new vscode.Range(document.positionAt(link.start), document.positionAt(link.end));
            const diagnostic = new vscode.Diagnostic(range, `Link target not found: ${link.target}`, vscode.DiagnosticSeverity.Warning);
            diagnostic.source = 'HAKBa';
            missing.push(diagnostic);
          }
        }));
      } catch { /* Documents outside Git repositories have no HAKBa links. */ }
      if (revision !== linkRevision || document.version !== version || document.isClosed) return;
      diagnostics.set(document.uri, missing);
      editor.setDecorations(missingLinkStyle, missing.map(item => item.range));
    }));
  }
  const linkWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(diagnostics, missingLinkStyle, linkWatcher,
    linkWatcher.onDidCreate(() => {void refreshLinks();}),
    linkWatcher.onDidDelete(() => {void refreshLinks();}),
    vscode.window.onDidChangeVisibleTextEditors(() => {void refreshLinks();}),
    vscode.workspace.onDidChangeTextDocument(() => {void refreshLinks();}),
    vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri)));
  void refreshLinks();
  const refresh = () => {dateCache.clear(); events.fire();};
  const safe = (fn: (...args:any[]) => Promise<unknown>) => async (...args:any[]) => {
    try {return await fn(...args);} catch (error) {vscode.window.showErrorMessage(`HAKBa: ${(error as Error).message}`);}
  };
  const command = (id: string, fn: (...args:any[]) => Promise<unknown>) => context.subscriptions.push(vscode.commands.registerCommand(id, safe(fn)));
  async function location(uri?: vscode.Uri): Promise<{root:string; selected:string}> {
    const selected = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!selected) throw new Error('Open a Git repository.');
    return {root:await core.repository(selected), selected};
  }
  async function open(file: string) {await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));}
  command('hakba.openLink', async (origin: string, target: string) => {
    const root = await core.repository(origin);
    const file = await core.resolveTarget(root, target);
    try {await fs.stat(file);} catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (path.extname(file).toLowerCase() !== '.md') throw new Error(`Link target not found: ${target}`);
      try {await core.createMarkdown(root, target);} catch (creationError) {
        if ((creationError as NodeJS.ErrnoException).code !== 'EEXIST') throw creationError;
      }
    }
    await open(file);
  });
  context.subscriptions.push(vscode.languages.registerDocumentLinkProvider(markdown, {
    provideDocumentLinks(document) {
      return core.links(document.getText()).map(link => {
        const args = encodeURIComponent(JSON.stringify([document.uri.fsPath, link.target]));
        const result = new vscode.DocumentLink(new vscode.Range(document.positionAt(link.start), document.positionAt(link.end)), vscode.Uri.parse(`command:hakba.openLink?${args}`));
        result.tooltip = `Open / create Markdown: ${link.target}`;
        return result;
      });
    }
  }));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(markdown, {
    async provideCompletionItems(document, position, token) {
      const partial = core.completionAt(document.getText(), document.offsetAt(position));
      if (!partial) return;
      try {
        const root = await core.repository(document.uri.fsPath);
        const candidates = await core.files(root);
        if (token.isCancellationRequested) return;
        return candidates.filter(file => file.toLowerCase().includes(partial.prefix.toLowerCase())).map(file => {
          const item = new vscode.CompletionItem(file, vscode.CompletionItemKind.File);
          item.range = new vscode.Range(document.positionAt(partial.start), position);
          item.insertText = file + (/^(?:\]\]|\|)/.test(document.getText().slice(document.offsetAt(position))) ? '' : ']]');
          item.filterText = file;
          return item;
        });
      } catch {return [];}
    }
  }, '[', '/'));
  command('hakba.initialize', async (uri?: vscode.Uri) => {
    const {root} = await location(uri);
    // Validate all destinations before touching an existing layout.
    for (const name of [...core.categories, '_index.md']) await core.resolveTarget(root, name);
    await core.initializeSpace(root);
    await open(path.join(root, '_index.md'));
  });
  command('hakba.createSpace', async (uri?: vscode.Uri) => {
    const {root, selected} = await location(uri);
    const parent = await core.nearestSpace(root, selected);
    const name = await vscode.window.showInputBox({prompt:'Space name (date prefix added automatically)', validateInput:value => !value.trim() || /[\\/:*?"<>|\x00-\x1f]/.test(value) || ['.','..'].includes(value.trim()) ? 'Enter a single directory name.' : undefined});
    if (!name) return;
    const relative = path.relative(root, path.join(parent, core.datePrefix()+name.trim())).split(path.sep).join('/');
    const dir = await core.resolveTarget(root, relative);
    await fs.mkdir(dir); // Exclusive: never merge a newly requested Space with an existing one.
    await core.initializeSpace(dir);
    await open(path.join(dir, '_index.md'));
  });
  command('hakba.createFile', async (uri?: vscode.Uri) => {
    const {root, selected} = await location(uri);
    const space = await core.nearestSpace(root, selected);
    const kind = await vscode.window.showQuickPick(core.categories, {placeHolder:'Information category'});
    if (!kind) return;
    const name = await vscode.window.showInputBox({prompt:'File name (subdirectories allowed; .md is optional)', validateInput:value => !value.trim() || value.split('/').some(p => !p || p === '.' || p === '..') || /[\\:*?"<>|\x00-\x1f]/.test(value) ? 'Enter a valid relative file name.' : undefined});
    if (!name) return;
    const filename = name.endsWith('.md') ? name : `${name}.md`;
    const rel = path.relative(root, path.join(space, kind, filename)).split(path.sep).join('/');
    await open(await core.createMarkdown(root, rel));
  });
  command('hakba.approve', async (uri?: vscode.Uri) => {
    const {root, selected} = await location(uri);
    await core.resolveTarget(root, path.relative(root, selected).split(path.sep).join('/'));
    if (core.category(root, selected) !== '_knowledges' || path.extname(selected) !== '.md') throw new Error('Select a Knowledge Markdown file.');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(selected));
    await vscode.window.showTextDocument(document);
    const choice = await vscode.window.showWarningMessage('Approve this entire Knowledge as your own understanding, interpretation, and judgment?', {modal:true}, 'Approve');
    if (choice !== 'Approve') return;
    const text = document.getText();
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), core.approve(text));
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('Could not update the approval status.');
    await document.save();
  });
  command('hakba.refreshDates', async () => refresh());
  context.subscriptions.push(events, vscode.languages.registerCodeLensProvider(markdown, {
    onDidChangeCodeLenses:events.event,
    async provideCodeLenses(document, token) {
      try {
        const root = await core.repository(document.uri.fsPath);
        const key = document.uri.fsPath;
        let pending = dateCache.get(key);
        if (!pending) {pending = core.dates(root, key); dateCache.set(key, pending); pending.catch(() => dateCache.delete(key));}
        const dates = await pending;
        if (token.isCancellationRequested) return [];
        const date = (value:string) => new Date(value).toLocaleString('en');
        const title = dates.created && dates.updated ? `Created: ${date(dates.created)}  Updated: ${date(dates.updated)}${dates.shallow ? ' (available history in a shallow clone)' : ''}` : `No Git history${dates.shallow ? ' (shallow clone)' : ''}`;
        return [new vscode.CodeLens(new vscode.Range(0,0,0,0), {title, command:'hakba.refreshDates', tooltip:'Refresh Git history'})];
      } catch {return [];}
    }
  }));
  // Git extension events also cover worktrees whose Git directory is outside the workspace.
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  void gitExtension?.activate().then(extension => {
    if (!extension?.getAPI) return;
    const api = extension.getAPI(1);
    const observed = new Set<string>();
    const observe = (repo:any) => {
      const key = repo.rootUri.toString();
      if (!observed.has(key)) {observed.add(key); context.subscriptions.push(repo.state.onDidChange(refresh));}
    };
    api.repositories.forEach(observe);
    context.subscriptions.push(api.onDidOpenRepository(observe));
  });
  const watcher = vscode.workspace.createFileSystemWatcher('**/.git/{HEAD,index,packed-refs,shallow,refs/**}');
  context.subscriptions.push(watcher, watcher.onDidChange(refresh), watcher.onDidCreate(refresh), watcher.onDidDelete(refresh), vscode.window.onDidChangeWindowState(state => {if (state.focused) refresh();}));
}
export function deactivate(): void {}
