#!/usr/bin/env node

import path from 'path';
import { execa } from 'execa';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 <paths...> [options]')
  .example(
    '$0 ./src --dry-run',
    'Run the codemod in dry-run mode on the ./src directory'
  )
  .command('$0 <paths...>', 'Run the Mystique Icon codemod', {}, (argv) => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const transformScriptPath = path.resolve(
      __dirname,
      '../transforms/icon-transform.cjs'
    );
    // ES Module에서는 require.resolve를 사용할 수 없으므로 직접 경로를 지정합니다.
    // jscodeshift 명령어를 직접 사용합니다 - npx를 통해 실행되면 PATH에서 찾을 것입니다
    const jscodeshiftExecutable = path.resolve(
      __dirname,
      '../node_modules/.bin/jscodeshift'
    );

    const args = ['-t', transformScriptPath, ...argv.paths];

    if (argv.dryRun) {
      args.push('--dry');
    }
    if (argv.verbose) {
      args.push('--verbose', argv.verbose.toString());
    }
    if (argv.print) {
      args.push('--print');
    }
    if (argv.extensions) {
      args.push('--extensions', argv.extensions);
    }
    if (argv.parser) {
      args.push('--parser', argv.parser);
    }
    // jscodeshift의 다른 옵션들을 필요에 따라 추가할 수 있습니다.
    // 예: --ignore-pattern, --ignore-config

    console.log(
      chalk.yellow(`Running transform: ${path.basename(transformScriptPath)}`)
    );
    console.log(chalk.blue(`jscodeshift arguments: ${args.join(' ')}`));

    try {
      // jscodeshift를 직접 실행합니다.
      // stdio: 'inherit' 옵션으로 jscodeshift의 출력을 실시간으로 보여줍니다.
      execa(jscodeshiftExecutable, args, { stdio: 'inherit' });
      console.log(chalk.green('Mystique Icon codemod finished successfully!'));
    } catch (error) {
      console.error(chalk.red('Mystique Icon codemod failed:'));
      // 에러 객체에 stdout, stderr 등이 포함될 수 있지만,
      // stdio: 'inherit'를 사용하면 이미 터미널에 출력되었을 것입니다.
      // error.status는 jscodeshift의 exit code입니다.
      if (error.status) {
        console.error(
          chalk.red(`jscodeshift exited with status ${error.status}`)
        );
      }
      process.exit(1); // 실패 시 non-zero exit code
    }
  })
  .option('dry-run', {
    alias: 'd',
    type: 'boolean',
    description: 'Dry run (no changes are made to files)',
    default: false,
  })
  .option('verbose', {
    alias: 'v',
    type: 'count',
    description: 'Show more information about the transform',
  })
  .option('print', {
    alias: 'p',
    type: 'boolean',
    description: 'Print output, dry run will always print',
    default: false,
  })
  .option('extensions', {
    type: 'string',
    description: 'File extensions to transform',
    default: 'tsx,ts',
  })
  .option('parser', {
    type: 'string',
    description: 'Parser to use (e.g., flow, ts, tsx, babylon)',
    default: 'tsx',
  })
  .demandCommand(1, 'You need to provide at least one path to transform.')
  .help()
  .alias('h', 'help')
  .epilogue(
    'For more information, find the documentation at https://github.com/your-repo/mystique-icon-codemod (replace with your actual repo URL)'
  ).argv;
