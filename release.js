'use strict';

const fs = require('fs');
const path = require('path');
const semver = require('semver');
const { cwd } = require('process');
const enquirer = require('enquirer');

const { prompt } = enquirer;

async function main() {
    const chalk = (await import('chalk')).default; 
    const { execa } = await import('execa'); 

    const currentVersion = JSON.parse(fs.readFileSync(path.resolve(cwd(), 'package.json'), 'utf-8')).version;
    const versionIncrements = ['patch', 'minor', 'major'];

    const inc = (i) => semver.inc(currentVersion, i);
    const run = async (bin, args, opts = {}) => {
        try {
            await execa(bin, args, { stdio: 'inherit', ...opts });
        } catch (err) {
            console.error(chalk.red(`Error running command: ${bin} ${args.join(' ')}`));
            console.error(err.message);
            process.exit(1);
        }
    };
    const step = (msg) => console.log(chalk.cyan(msg));

    let targetVersion;

    try {
        const { release } = await prompt({
            type: 'select',
            name: 'release',
            message: 'Select release type:',
            choices: versionIncrements.map((i) => `${i} (${inc(i)})`).concat(['custom']),
        });

        if (release === 'custom') {
            const { version } = await prompt({
                type: 'input',
                name: 'version',
                message: 'Input custom version:',
                initial: currentVersion,
            });
            targetVersion = version;
        } else {
            targetVersion = release.match(/\((.*)\)/)[1];
        }

        if (!semver.valid(targetVersion)) {
            throw new Error(`Invalid target version: ${targetVersion}`);
        }

        const { yes: tagOk } = await prompt({
            type: 'confirm',
            name: 'yes',
            message: `Releasing v${targetVersion}. Confirm?`,
        });

        if (!tagOk) {
            console.log(chalk.yellow('Release canceled.'));
            return;
        }

        step('\nUpdating the package version...');
        updatePackage(targetVersion);

        step('\nGenerating the changelog...');
        await run('pnpm', ['run', 'changelog']);

        const { yes: changelogOk } = await prompt({
            type: 'confirm',
            name: 'yes',
            message: `Changelog generated. Does it look good?`,
        });

        if (!changelogOk) {
            console.log(chalk.yellow('Release canceled after changelog review.'));
            return;
        }

        step('\nCommitting changes...');
        await run('git', ['add', 'CHANGELOG.md', 'package.json']);
        await run('git', ['commit', '-m', `release: v${targetVersion}`]);
        await run('git', ['tag', `v${targetVersion}`]);

        step('\nPublishing the package...');
        await run('pnpm', ['publish', '--access', 'public']);

        step('\nPushing to GitHub...');
        await run('git', ['push', 'origin', `refs/tags/v${targetVersion}`]);
        await run('git', ['push']);

        console.log(chalk.green(`\nSuccessfully released v${targetVersion}!`));
    } catch (err) {
        console.error(chalk.red(`\nAn error occurred during the release process:`));
        console.error(err.message);
        process.exit(1);
    }
}

function updatePackage(version) {
    const pkgPath = path.resolve(cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    pkg.version = version;

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n');
    console.log(`Updated package.json version to ${version}`);
}

main().catch((err) => {
    console.error(`\nUnexpected error:`);
    console.error(err.message);
    process.exit(1);
});
