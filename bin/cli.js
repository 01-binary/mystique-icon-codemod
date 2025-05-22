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
    'Run the codemod in dry-run mode on the ./src directory (uses default "icon" script)'
  )
  .example(
    '$0 ./src --script icon-prop',
    'Run the "icon-prop" codemod on the ./src directory'
  )
  .command('$0 <paths...>', 'Run the Mystique Icon codemod', {}, (argv) => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Define available scripts and their user-friendly keys
    const SCRIPT_MAP = {
      icon: '../transforms/icon-transform.cjs', // Original Icon component transform
      'icon-prop': '../transforms/icon-prop-to-component-transform.cjs', // Transform for components with icon string props
    };

    const selectedScriptKey = argv.script; // Get from yargs 'script' option
    const transformFile = SCRIPT_MAP[selectedScriptKey];

    if (!transformFile) {
      console.error(
        chalk.red(
          `Invalid script key: '${selectedScriptKey}'. Available keys: ${Object.keys(
            SCRIPT_MAP
          ).join(', ')}`
        )
      );
      process.exit(1);
    }

    const transformScriptPath = path.resolve(__dirname, transformFile);
    // ES Module에서는 require.resolve를 사용할 수 없으므로 직접 경로를 지정합니다.
    // jscodeshift 명령어를 직접 사용합니다 - npx를 통해 실행되면 PATH에서 찾을 것입니다
    const jscodeshiftExecutable = path.resolve(
      __dirname,
      '../node_modules/.bin/jscodeshift'
    );

    // 사용자가 전달한 경로들을 해석할 기준 디렉토리를 결정합니다.
    // npx는 process.cwd()를 변경할 수 있으므로, INIT_CWD를 우선적으로 확인합니다.
    const invocationCwd = process.env.INIT_CWD || process.cwd();
    console.log(chalk.magenta(`Effective CWD for path resolution: ${invocationCwd}`));
    if (process.env.INIT_CWD) {
      console.log(chalk.magenta(`(Using INIT_CWD: ${process.env.INIT_CWD})`));
    } else {
      console.log(chalk.magenta(`(Using process.cwd(): ${process.cwd()})`));
    }

    // 사용자가 전달한 경로들을 결정된 CWD 기준으로 절대 경로로 변환합니다.
    const resolvedPaths = argv.paths.map((p) => {
      const absolutePath = path.resolve(invocationCwd, p);
      // 디버깅을 위해 변환된 경로를 로그로 출력할 수 있습니다.
      console.log(
        chalk.cyan(
          `Input path: '${p}', Resolved to: '${absolutePath}' (using CWD: ${invocationCwd})`
        )
      );
      return absolutePath;
    });

    // jscodeshift에 전달할 인자 배열 (변환된 절대 경로 사용)
    const args = ['-t', transformScriptPath, ...resolvedPaths];

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
  .option('script', {
    alias: 's',
    type: 'string',
    description:
      'Specify the transform script to run. \n"icon": Transforms <Icon icon="string"> to new individual icon components. \n"icon-prop": Transforms icon="string" prop in various components (e.g., BottomNavItem) to icon={<IconComponent />}.',
    choices: ['icon', 'icon-prop'],
    default: 'icon',
  })
  .demandCommand(1, 'You need to provide at least one path to transform.')
  .help()
  .alias('h', 'help')
  .epilogue(
    'For more information, find the documentation at https://github.com/your-repo/mystique-icon-codemod (replace with your actual repo URL)'
  ).argv;
