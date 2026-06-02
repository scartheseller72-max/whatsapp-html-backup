'use strict';

/**
 * Interactive setup wizard (stdlib readline, no dependencies).
 *
 * Asks a short series of questions and returns an args-shaped object that the
 * CLI layer merges exactly like command-line flags. Pressing Enter accepts the
 * shown default.
 */

const readline = require('readline');

function ask(rl, question, def) {
  const suffix = def ? ` [${def}]` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve((answer || '').trim() || def || '');
    });
  });
}

async function runWizard() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n  WhatsApp HTML Backup — setup wizard\n  (press Enter to accept the [default])\n');

  const args = {};

  const scope = (await ask(rl, 'Back up (a)ll chats or (s)elected', 'a')).toLowerCase();
  if (scope.startsWith('s')) {
    const list = await ask(rl, 'Chat names/numbers, comma-separated', '');
    if (list) args.chats = list;
  }

  const from = await ask(rl, 'From date YYYY-MM-DD (blank = beginning)', '');
  if (from) args.from = from;
  const to = await ask(rl, 'To date YYYY-MM-DD (blank = now)', '');
  if (to) args.to = to;

  const media = (await ask(rl, 'Download media? (y/n)', 'y')).toLowerCase();
  if (media.startsWith('n')) args.noMedia = true;

  const groups = (await ask(rl, 'Include group chats? (y/n)', 'y')).toLowerCase();
  if (groups.startsWith('n')) args.noGroups = true;

  const incremental = (await ask(rl, 'Incremental (only new since last run)? (y/n)', 'n')).toLowerCase();
  if (incremental.startsWith('y')) args.incremental = true;

  const formats = await ask(rl, 'Extra exports? comma list of html,pdf,json,csv,singlefile', 'html');
  if (formats) args.format = formats;

  const out = await ask(rl, 'Output directory', 'output');
  if (out) args.out = out;

  rl.close();
  console.log('');
  return args;
}

module.exports = { runWizard };
