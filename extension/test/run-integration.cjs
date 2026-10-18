const {runTests} = require('@vscode/test-electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
// VSCode terminals can inherit Electron's Node mode; the test executable must launch as a GUI.
delete process.env.ELECTRON_RUN_AS_NODE;
(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'hakba-vscode-'));
  const fixture = path.join(temporary,'repo');
  await fs.mkdir(fixture);
  try {
    execFileSync('git',['init','-b','main',fixture]);
    await fs.writeFile(path.join(fixture,'links.md'),'[[日本語 空白.md]] [[data.csv]] [[picture.png]] [[missing.md]]\n`[[hidden.md]]`\n');
    await fs.writeFile(path.join(fixture,'日本語 空白.md'),'# target\n');
    await fs.writeFile(path.join(fixture,'data.csv'),'a,b\n1,2\n');
    await fs.writeFile(path.join(fixture,'picture.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
    await runTests({extensionDevelopmentPath:path.resolve(__dirname,'..'),extensionTestsPath:path.resolve(__dirname,'../out/test/integration.js'),launchArgs:[fixture,'--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-extension','github.copilot-chat','--skip-welcome','--skip-release-notes',`--user-data-dir=${path.join(temporary,'user-data')}`,`--extensions-dir=${path.join(temporary,'extensions')}`], ...(process.env.HAKBA_VSCODE_EXECUTABLE ? {vscodeExecutablePath:process.env.HAKBA_VSCODE_EXECUTABLE} : {})});
  } finally {await fs.rm(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
