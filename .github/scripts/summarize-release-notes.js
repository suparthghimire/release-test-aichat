import axios from "axios";
import { Octokit } from "octokit";
import { OpenAI } from "openai";
import { markdownToBlocks as markdownToSlackBlockKit } from "@tryfabric/mack";

async function createLatestRelease() {
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

  const tagName = process.env.RELEASE_TAG;
  if (!tagName) {
    throw new Error("RELEASE_TAG is required (set it in your CI environment)");
  }

  const latestRelease = await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name: tagName,
    name: `Release ${tagName}`,
    body: "", // placeholder; you'll overwrite this later with the OpenAI summary
    draft: false,
    prerelease: false,
  });

  console.log("Latest release:", latestRelease.data.name);

  return latestRelease;
}

async function updateReleaseNotes(releaseId, content) {
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

  await octokit.rest.repos.updateRelease({
    owner,
    repo,
    release_id: releaseId,
    body: content,
  });
  console.log("Release Notes updated");
}

async function getOpenAISummary(content) {
  const openAiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const prompt = `
    Generate clear and user-friendly release notes from these commit logs in markdown format with no special characters:
    \`\`\`
    ${content}
    \`\`\`
    The release notes should focus only on **user-facing changes**. Ignore any internal updates or dev tools changes that do not impact the user experience.

    - **Key Focus**: Only include **new features**, **bug fixes**, **enhancements**, or **important user-facing changes**.
    - **Exclude**: Any updates related to development dependencies, tools, linting, formatting, or internal configurations. Specifically, exclude changes related to the following keywords:
      - dev dependencies
      - tools updates
      - non-user facing changes
      - biome
      - linting
      - eslint
      - npm 
      - formatting
      - typescript
      - prettier
      - husky
    - **Objective**: Provide users with concise, clear, and engaging descriptions of what has changed in the release.


    #### **Steps:**

    1. **Review** the commit messages  to identify the **user-facing** changes (features, bug fixes, or other improvements).
    2. **Exclude** any changes related to the tools or technologies mentioned in the **Keywords to Avoid** section above. If a commit message or code change refers to these excluded topics, do **not include it** in the final release note.
    3. **Summarize** the relevant changes into simple and professional language that a user would care about.
    4. **Organize** the changes into the following sections:
        - **New Features**: List any new features or functionality that have been introduced.
        - **Bug Fixes**: List any issues that have been fixed, improving user experience or performance.
        - **Extra Notes**: Any additional important information or recommendations for users.
    5. **Do not include** internal dev dependencies or non-user-facing updates.
    6. **Focus on** the key changes that would directly impact users' experience.

    #### **Format for Output:**

    # What's New

    ## New Features
    • [Brief description of the new feature]  
    • [Brief description of another new feature]

    ## Bug Fixes
    • [Brief description of the bug fix]  
    • [Brief description of another bug fix]

    ## Extra Notes
    • [Any additional notes for the users]

  `;
  const chatCompletion = await openAiClient.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
  });

  console.log("Release Notes summarized by OpenAI");

  return chatCompletion.choices[0].message.content;
}

async function sendToSlack({ ghLink }) {
  if (!process.env.SLACK_WEBHOOK_URL)
    throw new Error("Slack webhook URL is required");

  const messageOnSlack = `@channel\nNew Release for AIChat is out! 🎉\nCheck the release notes below:\n[View Release in Github](${ghLink})`;

  const blocks = await markdownToSlackBlockKit(messageOnSlack);

  await axios.post(process.env.SLACK_WEBHOOK_URL, {
    blocks: blocks,
  });
  console.log("Release Notes sent to Slack");
}

async function summarizeReleaseNotes() {
  if (!process.env.GITHUB_TOKEN) throw new Error("GitHub token is required");

  if (!process.env.OPENAI_API_KEY)
    throw new Error("OpenAI API key is required");

  if (!process.env.SLACK_WEBHOOK_URL)
    throw new Error("Slack webhook URL is required");

  if (!process.env.RELEASE_TAG) throw new Error("RELEASE_TAG is required");

  const latestRelease = await createLatestRelease();

  const content = latestRelease.data.body;
  const summary = await getOpenAISummary(content);

  await updateReleaseNotes(latestRelease.data.id, summary).catch((err) => {
    console.error("Error updating release notes", err);
  });

  await sendToSlack({
    notes: summary,
    ghLink: latestRelease.data.html_url,
  }).catch((err) => {
    console.error("Error sending release notes to Slack", err);
  });
}

// Run the function
summarizeReleaseNotes()
  .then(() => {
    console.log("Release notes summarized and message sent to slack");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
