import { Octokit } from "@octokit/rest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

async function uploadToGithub() {
  console.log("Getting GitHub token...");
  const token = execSync('"C:\\Program Files\\GitHub CLI\\gh.exe" auth token').toString().trim();
  const username = execSync('"C:\\Program Files\\GitHub CLI\\gh.exe" api user -q .login').toString().trim();
  
  const octokit = new Octokit({ auth: token });
  const repoName = "seawave-backend";
  
  console.log(`Creating repository ${repoName} for user ${username}...`);
  try {
    await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      private: false,
      auto_init: true // create initial commit with README
    });
    console.log("Repository created!");
  } catch (e) {
    console.log("Repository might already exist, continuing...");
  }

  // Wait a few seconds for repo to be fully initialized
  await new Promise(r => setTimeout(r, 3000));

  const baseDir = "E:\\website antigrevity\\backend";
  
  // Recursively get all files excluding node_modules and .env
  function getFiles(dir, filesList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (file === "node_modules" || file === ".env") continue;
      
      if (fs.statSync(fullPath).isDirectory()) {
        getFiles(fullPath, filesList);
      } else {
        filesList.push(fullPath);
      }
    }
    return filesList;
  }

  const allFiles = getFiles(baseDir);
  console.log(`Found ${allFiles.length} files to upload.`);

  for (const filePath of allFiles) {
    const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, "base64");
    
    console.log(`Uploading ${relativePath}...`);
    try {
      // Check if file exists to get its SHA (required for updating)
      let sha = undefined;
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner: username,
          repo: repoName,
          path: relativePath,
        });
        sha = data.sha;
      } catch (e) { /* File doesn't exist yet */ }

      await octokit.rest.repos.createOrUpdateFileContents({
        owner: username,
        repo: repoName,
        path: relativePath,
        message: `Add ${relativePath}`,
        content: content,
        sha: sha
      });
    } catch (err) {
      console.error(`Failed to upload ${relativePath}:`, err.message);
    }
  }
  
  console.log("✅ All files uploaded successfully!");
  console.log(`Your code is now at: https://github.com/${username}/${repoName}`);
}

uploadToGithub().catch(console.error);
