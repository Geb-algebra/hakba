import * as path from 'node:path';
import {parseDocument, isMap} from 'yaml';
import MarkdownIt from 'markdown-it';
import * as fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
const markdownParser = new MarkdownIt();
export const categories = ['_contexts', '_sources', '_knowledges', '_outputs'] as const;
export type Category = typeof categories[number];
export async function git(cwd: string, args: string[]): Promise<string> {
  return (await exec('git', ['-C', cwd, ...args], {encoding:'utf8', maxBuffer:32 * 1024 * 1024})).stdout;
}
export async function repository(file: string): Promise<string> {
  const stat = await fs.stat(file);
  return (await git(stat.isDirectory() ? file : path.dirname(file), ['rev-parse', '--show-toplevel'])).trim();
}
export function inside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
export async function resolveTarget(root: string, target: string): Promise<string> {
  if (!target || target.includes('\\') || target.includes('\0') || target.includes('#') || target.includes('?') || target.includes(':') || path.isAbsolute(target) || target.split('/').includes('.git')) throw new Error('Specify a repository-relative path with a file extension.');
  const file = path.resolve(root, target);
  if (!inside(root, file) || file === root) throw new Error('Paths outside the repository are not allowed.');
  const realRoot = await fs.realpath(root);
  let ancestor = file;
  while (true) {
    try {
      const real = await fs.realpath(ancestor);
      if (!inside(realRoot, real)) throw new Error('Symbolic links outside the repository are not allowed.');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  return file;
}
export function category(root: string, file: string): Category | undefined {
  return path.relative(root, file).split(path.sep).find(p => categories.includes(p as Category)) as Category | undefined;
}
export function template(file: string, kind?: Category): string {
  const title = path.basename(file, '.md');
  return `${kind === '_knowledges' ? '---\ndraft: true\n---\n\n' : ''}# ${title}\n\n${kind === '_sources' ? '## Source\n\n- URL / Access date:\n\n## Content\n\n' : ''}`;
}
export async function createMarkdown(root: string, target: string): Promise<string> {
  const file = await resolveTarget(root, target);
  if (path.extname(file).toLowerCase() !== '.md') throw new Error('Only .md files can be created.');
  await fs.mkdir(path.dirname(file), {recursive:true});
  await fs.writeFile(file, template(file, category(root, file)), {flag:'wx'});
  return file;
}
export async function initializeSpace(dir: string): Promise<void> {
  await fs.mkdir(dir, {recursive:true});
  for (const name of categories) await fs.mkdir(path.join(dir, name), {recursive:true});
  try { await fs.writeFile(path.join(dir, '_index.md'), `# ${path.basename(dir)}\n\n## Purpose\n\n## Outcomes\n\n## Tasks\n\n## Plan\n`, {flag:'wx'}); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}
export async function nearestSpace(root: string, start: string): Promise<string> {
  let dir = (await fs.stat(start)).isDirectory() ? start : path.dirname(start);
  while (inside(root, dir)) {
    try { if ((await fs.stat(path.join(dir, '_index.md'))).isFile()) return dir; } catch { /* ancestor */ }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  throw new Error('No Space found. Initialize the repository first.');
}
export function datePrefix(date = new Date()): string {
  return `${String(date.getFullYear()).slice(-2)}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}_`;
}
export function classifiedFilename(name: string, kind: Category, date = new Date()): string {
  const filename = name.endsWith('.md') ? name : `${name}.md`;
  if (kind !== '_sources' && kind !== '_outputs') return filename;
  const basename = path.basename(filename);
  return /^\d{6}_/.test(basename) ? filename : path.join(path.dirname(filename), datePrefix(date) + basename);
}
// Length of the root-relative directory prefix shared by the two files.
export function sharedLinkPrefix(root: string, origin: string, target: string): number {
  const originParts = path.relative(root, path.dirname(origin)).split(path.sep);
  const targetParts = target.split('/');
  let length = 0;
  for (let i = 0; i < targetParts.length - 1 && i < originParts.length; i++) {
    if (originParts[i] !== targetParts[i]) break;
    length += targetParts[i].length + 1;
  }
  return length;
}
export function approve(text: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const fm = /^(\uFEFF?)---\r?\n((?:[^\n]*\n)*?)---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!fm) {
    if (/^\uFEFF?---(?:\r?\n|$)/.test(text)) throw new Error('Frontmatter is not closed.');
    return `---${eol}draft: false${eol}---${eol}${eol}${text}`;
  }
  const metadata = parseDocument(fm[2]);
  if (metadata.errors.length || (metadata.contents !== null && !isMap(metadata.contents))) throw new Error('Fix the frontmatter YAML before approving.');
  metadata.set('draft', false);
  const body = metadata.toString().trimEnd().replace(/\n/g, eol);
  const tail = text.slice(fm[0].length);
  return `${fm[1]}---${eol}${body}${eol}---${fm[0].endsWith('\n') ? eol : ''}${tail}`;
}
export function proseMask(text: string): string {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const offsets = [0];
  for (const line of lines) offsets.push(offsets.at(-1)! + line.length);
  const chars = text.split('');
  const hide = (start:number, end:number) => {
    for (let i = start; i < end; i++) if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  };
  const tokens = markdownParser.parse(text, {});
  for (const token of tokens) {
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) hide(offsets[token.map[0]], offsets[token.map[1]]);
  }
  const masked = chars.join('');
  for (const token of tokens) {
    if (token.type !== 'inline' || !token.map) continue;
    const base = offsets[token.map[0]];
    const inline = masked.slice(base, offsets[token.map[1]]);
    const runs = [...inline.matchAll(/`+/g)];
    for (let i = 0; i < runs.length; i++) {
      const opening = runs[i];
      const slashes = /\\*$/.exec(inline.slice(0, opening.index!))![0].length;
      if (slashes % 2) continue;
      let closing = i + 1;
      while (closing < runs.length && runs[closing][0].length !== opening[0].length) closing++;
      if (closing < runs.length) {
        hide(base + opening.index!, base + runs[closing].index! + runs[closing][0].length);
        i = closing;
      }
    }
  }
  return chars.join('');
}
export interface WikiLink {start:number; end:number; target:string}
export function links(text: string): WikiLink[] {
  const mask = proseMask(text);
  return [...mask.matchAll(/\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g)].map(m => ({start:m.index!,end:m.index!+m[0].length,target:m[1]}));
}
export function completionAt(text: string, offset: number): {start:number; prefix:string} | undefined {
  const before = proseMask(text).slice(0, offset);
  const match = /\[\[([^\]\n|]*)$/.exec(before);
  return match ? {start:offset-match[1].length, prefix:match[1]} : undefined;
}
export async function files(root: string): Promise<string[]> {
  const [listed, ignored] = await Promise.all([
    git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
    git(root, ['ls-files', '--cached', '--ignored', '--exclude-standard', '-z'])
  ]);
  const excluded = new Set(ignored.split('\0'));
  const candidates = [...new Set(listed.split('\0').filter(Boolean))].filter(p => !excluded.has(p) && !p.split('/').includes('.git'));
  const present = await Promise.all(candidates.map(async p => {
    try {return (await fs.stat(await resolveTarget(root, p))).isFile() ? p : undefined;} catch {return undefined;}
  }));
  return present.filter((p):p is string => p !== undefined).sort();
}
export interface GitDates {created?:string; updated?:string; shallow:boolean}
export async function dates(root: string, file: string): Promise<GitDates> {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const [history, shallow] = await Promise.all([
    git(root, ['rev-parse', '--verify', 'HEAD']).then(() => git(root, ['log', '--follow', '--format=%cI', '--', rel]), () => ''),
    git(root, ['rev-parse', '--is-shallow-repository'])
  ]);
  const entries = history.trim().split('\n').filter(Boolean);
  return {created:entries.at(-1), updated:entries[0], shallow:shallow.trim() === 'true'};
}
