import fs from "fs";
import path from "path";
import { rollup } from "rollup";
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import express from 'express';

import stripJsonComments from 'strip-json-comments';

const cwd = process.cwd();
const rushJsonFile = path.join(cwd, "rush.json");

if (!fs.existsSync(rushJsonFile)) {
  console.error("Couldn't find rush.json");
  process.exit(-1);
}

const rushJson = JSON.parse(stripJsonComments(fs.readFileSync(rushJsonFile, { encoding: "utf8" }))) as {
  projects: Array<{ projectFolder: string }>
};

const projectDirs = rushJson.projects.map(project => project.projectFolder);
const elementPaths = projectDirs.map(projectDir => {
  const packageJsonPath = path.join(projectDir, "package.json");

  const packageJson = JSON.parse(stripJsonComments(fs.readFileSync(packageJsonPath, "utf8"))) as {
    name: string,
    main?: string
  };

  if (!packageJson.main) {
    console.warn(`Package ${packageJson.name} has not defined "main" property in package.json`);
    return null;
  }

  return path.join(projectDir, packageJson.main);
})
  .filter((x): x is string => x != null)

const app = express();

async function build() {
  const bundle = await rollup({
    input: elementPaths,
    plugins: [resolve(), commonjs()],
    preserveModules: false,
    preserveSymlinks: true,
  })

  const { output } = await bundle.generate({
    format: "es",
  });
 
  app.get('/', (req, res) => {
    res.send("<script src='ar-picker.js' type='module'></script>");
  })

  output.forEach(bundle => {
    app.get(`/packages/${bundle.fileName}`, (req, res) => {
      if (bundle.type === "asset") {
        res.send(bundle.source);
      } else if (bundle.type === "chunk") {
        res.setHeader('Content-Type', "application/javascript");
        res.send(bundle.code);
      }
    })
  })
}

build();

const port = 8080;
app.listen(port, () => console.log(`App listening on port ${port}!`));
