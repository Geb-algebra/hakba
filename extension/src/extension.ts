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
  const sharedLinkStyle = vscode.window.createTextEditorDecorationType({color: new vscode.ThemeColor('editorCodeLens.foreground')});
  let linkRevision = 0;
  async function refreshLinks(): Promise<void> {
    const revision = ++linkRevision;
    await Promise.all(vscode.window.visibleTextEditors.map(async editor => {
      const document = editor.document;
      if (document.languageId !== 'markdown' || document.uri.scheme !== 'file') return;
      const version = document.version;
      const missing: vscode.Diagnostic[] = [];
      const shared: vscode.Range[] = [];
      try {
        const root = await core.repository(document.uri.fsPath);
        await Promise.all(core.links(document.getText()).map(async link => {
          try {
            const file = await core.resolveTarget(root, link.target);
            const length = core.sharedLinkPrefix(root, document.uri.fsPath, link.target);
            if (length) shared.push(new vscode.Range(document.positionAt(link.start + 2), document.positionAt(link.start + 2 + length)));
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
      editor.setDecorations(sharedLinkStyle, shared);
    }));
  }
  const linkWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(diagnostics, missingLinkStyle, sharedLinkStyle, linkWatcher,
    linkWatcher.onDidCreate(() => {void refreshLinks();}),
    linkWatcher.onDidDelete(() => {void refreshLinks();}),
    vscode.window.onDidChangeVisibleTextEditors(() => {void refreshLinks();}),
    vscode.workspace.onDidChangeTextDocument(() => {void refreshLinks();}),
    vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri)));
  const draftChanges = new vscode.EventEmitter<vscode.Uri>();
  const isMarkdownFile = (uri: vscode.Uri) => uri.scheme === 'file' && path.extname(uri.fsPath).toLowerCase() === '.md';
  const refreshDraft = (uri: vscode.Uri) => {
    if (isMarkdownFile(uri)) draftChanges.fire(uri);
  };
  context.subscriptions.push(
    draftChanges,
    vscode.window.registerFileDecorationProvider({
      onDidChangeFileDecorations:draftChanges.event,
      async provideFileDecoration(uri, token) {
        if (!isMarkdownFile(uri)) return;
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
        const text = document?.getText() ?? await fs.readFile(uri.fsPath, 'utf8').catch(() => undefined);
        if (token.isCancellationRequested || text === undefined || !core.isDraft(text)) return;
        return new vscode.FileDecoration('D', 'Draft', new vscode.ThemeColor('list.warningForeground'));
      }
    }),
    linkWatcher.onDidCreate(refreshDraft),
    linkWatcher.onDidChange(refreshDraft),
    linkWatcher.onDidDelete(refreshDraft),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.contentChanges.length) refreshDraft(event.document.uri);
    }),
    vscode.workspace.onDidCloseTextDocument(document => refreshDraft(document.uri))
  );
  void refreshLinks();
  const refresh = () => {dateCache.clear(); events.fire();};
  const safe = (fn: (...args:any[]) => Promise<unknown>) => async (...args:any[]) => {
    try {return await fn(...args);} catch (error) {vscode.window.showErrorMessage(`HAKBa: ${(error as Error).message}`);}
  };
  const command = (id: string, fn: (...args:any[]) => Promise<unknown>) => context.subscriptions.push(vscode.commands.registerCommand(id, safe(fn)));
  async function location(uri?: vscode.Uri): Promise<{root:string; selected:string}> {
    const active = vscode.window.activeTextEditor?.document.uri;
    const selected = uri?.fsPath || (active?.scheme === 'file' ? active.fsPath : undefined) || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
  async function creationPath(root: string, selected: string, title: string, classified = false, fromExplorer = false): Promise<string | undefined> {
    const directory = fromExplorer
      ? await core.nearestSpace(root, selected)
      : (await fs.stat(selected)).isDirectory() ? selected : path.dirname(selected);
    const relative = path.relative(root, directory).split(path.sep);
    const categoryIndex = relative.findIndex(part => core.categories.some(kind => kind === part));
    const initial = (categoryIndex < 0 ? relative : relative.slice(0, categoryIndex)).join('/');
    type PathItem = vscode.QuickPickItem & {directory?: string; target?: string};
    const picker = vscode.window.createQuickPick<PathItem>();
    picker.title = title;
    picker.value = initial ? initial + '/' : '';
    let revision = 0;
    const update = async () => {
      const current = ++revision;
      const value = picker.value;
      const slash = value.lastIndexOf('/');
      const parent = value.slice(0, slash + 1);
      const segment = value.slice(slash + 1);
      const prefix = segment.toLowerCase();
      const error = core.validateCreationPath(value, classified);
      const validParent = !parent || !core.validateCreationPath(parent.slice(0, -1), classified, true);
      const inCategory = classified && core.categories.some(kind => parent.split('/').includes(kind));
      const choosingCategory = classified && !inCategory && prefix.startsWith('_');
      let action: PathItem = {label: error || `Create: ${value}`, target: error ? undefined : value, alwaysShow:true};
      picker.placeholder = inCategory ? 'Enter the file name (.md is optional)' : 'Enter a repository-relative path';
      if (!validParent) {
        picker.items = [action];
        return;
      }

      if (choosingCategory) {
        const choices = core.categories.filter(kind => kind.startsWith(prefix)).map(kind => ({
          label:kind.slice(1, -1),
          directory:parent + kind + '/', alwaysShow:true
        }));
        picker.items = choices.length ? choices : [{label:'No matching category', alwaysShow:true}];
        picker.activeItems = choices.slice(0, 1);
        return;
      }

      if (classified && !segment) {
        action = inCategory
          ? {label:'Enter the file name (.md is optional)', alwaysShow:true}
          : {label:'Press Enter to select a category', directory:parent + '_', alwaysShow:true};
      }
      picker.items = [action];
      picker.activeItems = [action];
      try {
        const dir = parent ? await core.resolveTarget(root, parent) : root;
        const entries = await fs.readdir(dir, {withFileTypes:true});
        if (revision !== current) return;
        const folders = entries
          .filter(entry => entry.isDirectory() && !core.validateCreationPath(entry.name) && entry.name.toLowerCase().startsWith(prefix))
          .map(entry => parent + entry.name + '/')
          .sort()
          .map(directory => ({label:directory, description:'Complete directory path', directory, alwaysShow:true}));
        if (classified && !inCategory && folders.some(folder => folder.directory === value + '/')) {
          action = {label:'Press Enter to select a category', directory:value + '/_', alwaysShow:true};
        }
        picker.items = [action, ...folders];
        picker.activeItems = [!action.directory && segment && error && folders.length ? folders[0] : action];
      } catch { /* A new directory can be entered before it exists. */ }
    };
    return await new Promise<string | undefined>(resolve => {
      const subscriptions = [
        picker.onDidChangeValue(() => {void update();}),
        picker.onDidAccept(() => {
          const item = picker.selectedItems[0];
          if (item?.directory) {
            picker.value = item.directory;
            return;
          }
          if (item?.target) {resolve(item.target); picker.hide();}
        }),
        picker.onDidHide(() => {
          revision++;
          resolve(undefined);
          subscriptions.forEach(subscription => subscription.dispose());
          picker.dispose();
        })
      ];
      void update();
      picker.show();
    });
  }
  command('hakba.createSpace', async (uri?: vscode.Uri) => {
    const {root, selected} = await location(uri);
    const target = await creationPath(root, selected, 'Space path (date prefix added automatically)', false, Boolean(uri));
    if (!target) return;
    const rel = path.posix.join(path.posix.dirname(target), core.datePrefix() + path.posix.basename(target));
    const dir = await core.resolveTarget(root, rel);
    await fs.mkdir(path.dirname(dir), {recursive:true});
    await fs.mkdir(dir); // Exclusive: never merge a newly requested Space with an existing one.
    await core.initializeSpace(dir);
    await open(path.join(dir, '_index.md'));
  });
  command('hakba.createFile', async (uri?: vscode.Uri) => {
    const {root, selected} = await location(uri);
    const target = await creationPath(root, selected, 'Markdown path (e.g. project/_sources/note)', true, Boolean(uri));
    if (!target) return;
    const kind = core.category(root, path.join(root, target))!;
    const filename = core.classifiedFilename(path.posix.basename(target), kind);
    const rel = path.posix.join(path.posix.dirname(target), filename);
    await open(await core.createMarkdown(root, rel, false));
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
