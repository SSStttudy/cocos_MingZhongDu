'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const sourceDirectory = path.join(__dirname, 'source', 'folder1');
const generatedDirectory = path.join(__dirname, 'generated', 'folder1');
const publicDirectory = path.join(__dirname, 'site', 'public', 'review-images', 'folder1');

async function convert(input, output) {
    await sharp(input)
        .resize({ width: 1800, height: 1350, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true })
        .toFile(output);
}

async function main() {
    fs.mkdirSync(publicDirectory, { recursive: true });
    const sourceNames = fs.readdirSync(sourceDirectory).filter((name) => name.endsWith('.png')).sort();
    for (const sourceName of sourceNames) {
        const stem = path.parse(sourceName).name;
        await convert(path.join(sourceDirectory, sourceName), path.join(publicDirectory, `${stem}-original.jpg`));
        await convert(
            path.join(generatedDirectory, `${stem}-style-v1.png`),
            path.join(publicDirectory, `${stem}-style-v1.jpg`),
        );
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
