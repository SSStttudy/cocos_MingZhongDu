'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = __dirname;
const jobs = [
    {
        id: 'IMG_20260714_155230',
        output: 'visitor-center-exterior-foreground-v1.png',
    },
    {
        id: 'IMG_20260714_155746',
        output: 'visitor-center-interior-foreground-v1.png',
    },
];

async function extract(job) {
    const source = path.join(root, 'generated', 'folder1', `${job.id}-style-v1.png`);
    const mask = path.join(root, 'masks', 'folder1', `${job.id}-foreground-mask-v1.png`);
    const outputDirectory = path.join(root, 'foregrounds', 'folder1');
    const output = path.join(outputDirectory, job.output);
    fs.mkdirSync(outputDirectory, { recursive: true });

    const metadata = await sharp(source).metadata();
    const color = await sharp(source)
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
    const alpha = await sharp(mask)
        .resize(metadata.width, metadata.height, { fit: 'fill' })
        .greyscale()
        .threshold(128)
        .blur(0.35)
        .raw()
        .toBuffer({ resolveWithObject: true });

    const rgba = Buffer.alloc(metadata.width * metadata.height * 4);
    for (let pixel = 0; pixel < metadata.width * metadata.height; pixel += 1) {
        rgba[pixel * 4] = color.data[pixel * 3];
        rgba[pixel * 4 + 1] = color.data[pixel * 3 + 1];
        rgba[pixel * 4 + 2] = color.data[pixel * 3 + 2];
        rgba[pixel * 4 + 3] = alpha.data[pixel];
    }

    await sharp(rgba, {
        raw: {
            width: metadata.width,
            height: metadata.height,
            channels: 4,
        },
    })
        .png({ compressionLevel: 9 })
        .toFile(output);

    const result = await sharp(output).metadata();
    process.stdout.write(`${output} ${result.width}x${result.height} ${result.channels}ch\n`);
}

Promise.all(jobs.map(extract)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
