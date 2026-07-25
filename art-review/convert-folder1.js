'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const sourceDirectory = String.raw`D:\Study\数媒\三下乡\S3_小程序\素材整理\1`;
const outputDirectory = path.join(__dirname, 'source', 'folder1');

async function main() {
    fs.mkdirSync(outputDirectory, { recursive: true });
    const names = fs.readdirSync(sourceDirectory)
        .filter((name) => /\.(jpe?g|mpo|png)$/i.test(name))
        .sort();

    for (const name of names) {
        const stem = path.parse(name).name;
        const output = path.join(outputDirectory, `${stem}.png`);
        await sharp(path.join(sourceDirectory, name), { pages: 1 })
            .rotate()
            .png({ compressionLevel: 9 })
            .toFile(output);
        process.stdout.write(`${output}\n`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
