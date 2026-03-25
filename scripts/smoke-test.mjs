import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));

const hostname = process.env.SMOKE_HOSTNAME?.trim() || "127.0.0.1";
const port = Number(process.env.SMOKE_PORT || 3100);
const baseUrl = process.env.SMOKE_BASE_URL?.trim() || `http://${hostname}:${port}`;
const headless = !args.has("--headed") && process.env.SMOKE_HEADLESS !== "false";
const strictConsole = args.has("--strict-console") || process.env.SMOKE_STRICT_CONSOLE === "true";
const reuseServer = args.has("--reuse-server") || process.env.SMOKE_REUSE_SERVER === "true";
const timestamp = Date.now();
const smokeDistDir = process.env.NEXT_DIST_DIR?.trim() || `.next-smoke-${port}-${timestamp}`;
const smokeDbSource = path.resolve(repoRoot, process.env.SMOKE_DB_SOURCE || "dev.db");

const serverStdout = [];
const serverStderr = [];

function pushLogLine(buffer, prefix, chunk) {
    const lines = String(chunk || "")
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);
    for (const line of lines) {
        const entry = `${prefix}${line}`;
        buffer.push(entry);
        if (buffer.length > 120) buffer.shift();
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureReadable(filePath) {
    await access(filePath, fsConstants.R_OK);
}

async function createIsolatedDbCopy() {
    await ensureReadable(smokeDbSource);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mission-control-smoke-"));
    const tempDbPath = path.join(tempDir, "smoke.db");
    await cp(smokeDbSource, tempDbPath);
    return {
        tempDir,
        tempDbPath,
        databaseUrl: `file:${tempDbPath}`,
    };
}

async function waitForServer(url, timeoutMs = 120000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${url}/api/health`, {
                redirect: "manual",
                cache: "no-store",
            });
            if (response.ok) return;
            lastError = new Error(`Health check returned ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await sleep(1000);
    }

    throw new Error(`Timed out waiting for ${url} to boot${lastError ? `: ${lastError.message}` : ""}`);
}

async function buildApp(databaseUrl) {
    const child = spawn(
        "npm",
        ["run", "build"],
        {
            cwd: repoRoot,
            env: {
                ...process.env,
                DATABASE_URL: databaseUrl,
                NEXT_DIST_DIR: smokeDistDir,
                CI: "true",
            },
            stdio: ["ignore", "pipe", "pipe"],
        }
    );

    child.stdout.on("data", (chunk) => pushLogLine(serverStdout, "[build] ", chunk));
    child.stderr.on("data", (chunk) => pushLogLine(serverStderr, "[build:err] ", chunk));

    const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
    });

    if (exitCode !== 0) {
        throw new Error(`Smoke build failed with exit code ${exitCode}`);
    }
}

function startServer(databaseUrl) {
    const child = spawn(
        "npx",
        ["next", "start", "--hostname", hostname, "--port", String(port)],
        {
            cwd: repoRoot,
            env: {
                ...process.env,
                DATABASE_URL: databaseUrl,
                NEXT_DIST_DIR: smokeDistDir,
                PORT: String(port),
                CI: "true",
            },
            stdio: ["ignore", "pipe", "pipe"],
        }
    );

    child.stdout.on("data", (chunk) => pushLogLine(serverStdout, "[start] ", chunk));
    child.stderr.on("data", (chunk) => pushLogLine(serverStderr, "[start:err] ", chunk));
    return child;
}

async function syncIsolatedDbSchema(databaseUrl) {
    const child = spawn(
        "npx",
        ["prisma", "db", "push", "--skip-generate"],
        {
            cwd: repoRoot,
            env: {
                ...process.env,
                DATABASE_URL: databaseUrl,
            },
            stdio: ["ignore", "pipe", "pipe"],
        }
    );

    child.stdout.on("data", (chunk) => pushLogLine(serverStdout, "[prisma] ", chunk));
    child.stderr.on("data", (chunk) => pushLogLine(serverStderr, "[prisma:err] ", chunk));

    const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
    });

    if (exitCode !== 0) {
        throw new Error(`Prisma schema sync failed with exit code ${exitCode}`);
    }
}

async function stopServer(child) {
    if (!child || child.exitCode !== null) return;
    child.kill("SIGINT");
    await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        sleep(5000),
    ]);
    if (child.exitCode === null) {
        child.kill("SIGKILL");
    }
}

async function readMainText(page) {
    return page.evaluate(() => document.querySelector("main")?.textContent?.replace(/\s+/g, " ").trim() || "");
}

async function readBodyText(page) {
    return page.evaluate(() => document.body?.textContent?.replace(/\s+/g, " ").trim() || "");
}

async function clickByExactText(page, rootSelector, text) {
    const clicked = await page.evaluate(({ rootSelector, text }) => {
        const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const root = rootSelector ? document.querySelector(rootSelector) : document;
        if (!root) return false;
        const candidates = Array.from(root.querySelectorAll("button, a"));
        const match = candidates.find((element) => {
            const label = normalize(element.getAttribute("aria-label"));
            const body = normalize(element.textContent);
            if ((element instanceof HTMLButtonElement) && element.disabled) return false;
            return label === text || body === text;
        });
        if (!match) return false;
        match.click();
        return true;
    }, { rootSelector, text });
    assert(clicked, `Unable to find clickable control with text "${text}" inside ${rootSelector || "document"}`);
}

async function clickFirstTaskBoardButton(page) {
    const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const match = buttons.find((element) => {
            const label = String(element.getAttribute("aria-label") || "").trim();
            return /Open .* task board/i.test(label) && !(element instanceof HTMLButtonElement && element.disabled);
        });
        if (!match) return false;
        match.click();
        return true;
    });
    return clicked;
}

async function waitForMainText(page, expectedText, timeoutMs = 30000) {
    await page.waitForFunction(
        (text) => {
            const main = document.querySelector("main");
            return Boolean(main && main.textContent && main.textContent.includes(text));
        },
        { timeout: timeoutMs },
        expectedText
    );
}

async function waitForTab(page, tabId, expectedText) {
    await page.waitForFunction(
        (tab) => new URL(window.location.href).searchParams.get("tab") === tab,
        { timeout: 30000 },
        tabId
    );
    await waitForMainText(page, expectedText, 30000);
}

function parseEditableTaskCount(text) {
    const match = text.match(/(\d+)\s+editable tasks from/i);
    return match ? Number(match[1]) : null;
}

async function getUrlSearchParam(page, key) {
    return page.evaluate((param) => new URL(window.location.href).searchParams.get(param), key);
}

async function waitForUrlSearchParamChange(page, key, previousValue, timeoutMs = 30000) {
    await page.waitForFunction(
        ({ key, previousValue }) => new URL(window.location.href).searchParams.get(key) !== previousValue,
        { timeout: timeoutMs },
        { key, previousValue }
    );
}

async function clickByAriaLabel(page, label) {
    const clicked = await page.evaluate((targetLabel) => {
        const match = Array.from(document.querySelectorAll("button, a")).find((element) => {
            const value = String(element.getAttribute("aria-label") || "").trim();
            return value === targetLabel && !(element instanceof HTMLButtonElement && element.disabled);
        });
        if (!match) return false;
        match.click();
        return true;
    }, label);
    assert(clicked, `Unable to find clickable control with aria-label "${label}"`);
}

async function clickByTextContains(page, fragment) {
    const clicked = await page.evaluate((targetFragment) => {
        const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const match = Array.from(document.querySelectorAll("button, a")).find((element) => {
            const label = normalize(element.getAttribute("aria-label"));
            const body = normalize(element.textContent);
            if (element instanceof HTMLButtonElement && element.disabled) return false;
            return label.includes(targetFragment) || body.includes(targetFragment);
        });
        if (!match) return false;
        match.click();
        return true;
    }, fragment);
    assert(clicked, `Unable to find clickable control containing text "${fragment}"`);
}

async function clickCommandCenterWeekControl(page, slot) {
    const clicked = await page.evaluate((slotName) => {
        const groups = Array.from(document.querySelectorAll("div")).filter((element) => {
            const buttons = Array.from(element.querySelectorAll(":scope > button"));
            if (buttons.length !== 3) return false;
            const middleText = String(buttons[1]?.textContent || "").trim();
            return middleText === "Current Week" || /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(middleText);
        });
        const group = groups[0];
        if (!group) return false;
        const buttons = Array.from(group.querySelectorAll(":scope > button"));
        const target = slotName === "prev" ? buttons[0] : slotName === "current" ? buttons[1] : buttons[2];
        if (!target || (target instanceof HTMLButtonElement && target.disabled)) return false;
        target.click();
        return true;
    }, slot);
    assert(clicked, `Unable to click Command Center week control "${slot}"`);
}

async function selectDifferentOption(page, selector) {
    return page.evaluate((selectSelector) => {
        const select = document.querySelector(selectSelector);
        if (!(select instanceof HTMLSelectElement)) return null;
        const current = select.value;
        const nextOption = Array.from(select.options).find((option) => option.value && option.value !== current);
        if (!nextOption) return null;
        select.value = nextOption.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return nextOption.value;
    }, selector);
}

async function setInputValue(page, selector, value) {
    await page.waitForSelector(selector, { timeout: 30000 });
    await page.$eval(selector, (element, nextValue) => {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
        element.focus();
        element.value = String(nextValue);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
}

async function typeIntoField(page, selector, value) {
    await page.waitForSelector(selector, { timeout: 30000 });
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type(selector, String(value));
}

async function clickNewClientRowSave(page) {
    const clicked = await page.evaluate(() => {
        const row = Array.from(document.querySelectorAll("[data-client-row]")).find((element) =>
            String(element.getAttribute("data-client-row") || "").startsWith("new-")
        );
        if (!row) return false;
        const saveButton = Array.from(row.querySelectorAll("button")).find((button) =>
            String(button.textContent || "").replace(/\s+/g, " ").trim() === "Save"
        );
        if (!saveButton || (saveButton instanceof HTMLButtonElement && saveButton.disabled)) return false;
        saveButton.click();
        return true;
    });
    assert(clicked, "Unable to save the new client row");
}

async function openFirstCapacityGridNoteEditor(page) {
    const opened = await page.evaluate(() => {
        const input = document.querySelector("[data-grid-cell] input[type='text']");
        if (!(input instanceof HTMLElement)) return false;
        input.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, composed: true }));
        return true;
    });
    assert(opened, "Unable to open the first Capacity Grid note editor");
}

async function clickFirstBacklogSegment(page) {
    const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const match = buttons.find((button) => {
            const title = String(button.getAttribute("title") || "");
            return title.includes("Existing backlog") || title.includes("New work added in month");
        });
        if (!match || (match instanceof HTMLButtonElement && match.disabled)) return false;
        match.click();
        return true;
    });
    assert(clicked, "Unable to click a backlog growth segment");
}

async function runSmoke(page, issues) {
    const results = [];
    let currentStep = "Boot landing page";
    let boardAssignee = null;

    const runStep = async (name, callback) => {
        currentStep = name;
        console.log(`[smoke] Running: ${name}`);
        await callback();
        results.push({ name, status: "passed" });
    };

    try {
        await runStep("Landing Page", async () => {
            await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
            await waitForMainText(page, "Command Center", 120000);
            assert((await page.title()).includes("Mission Control"), "The dashboard title did not load");
        });

        const tabChecks = [
            { navText: "Command Center", tabId: "command-center", expectedText: "Command Center" },
            { navText: "Billing Trends", tabId: "trends", expectedText: "Billing Trends" },
            { navText: "Capacity Trends", tabId: "capacity-trends", expectedText: "Capacity Trends" },
            { navText: "Consultant Utilization", tabId: "consultant-utilization", expectedText: "Consultant Utilization" },
            { navText: "Timesheets", tabId: "timesheets", expectedText: "Timesheets" },
            { navText: "Capacity Grid", tabId: "capacity-grid", expectedText: "Capacity Grid" },
            { navText: "Client Setup", tabId: "client-setup", expectedText: "Client Setup" },
            { navText: "Backlog Growth", tabId: "backlog-growth", expectedText: "Backlog Growth" },
        ];

        for (const check of tabChecks) {
            await runStep(`Sidebar: ${check.navText}`, async () => {
                await clickByExactText(page, "aside", check.navText);
                await waitForTab(page, check.tabId, check.expectedText);
            });
        }

        await runStep("Command Center Week Navigation", async () => {
            await page.goto(`${baseUrl}/?tab=command-center`, { waitUntil: "domcontentloaded", timeout: 120000 });
            await waitForTab(page, "command-center", "Command Center");
            const startingWeek = await getUrlSearchParam(page, "week");
            await clickCommandCenterWeekControl(page, "prev");
            await waitForUrlSearchParamChange(page, "week", startingWeek);
            const previousWeek = await getUrlSearchParam(page, "week");
            assert(previousWeek !== startingWeek, "Command Center previous week navigation did not update the URL");
            await clickCommandCenterWeekControl(page, "current");
            await waitForUrlSearchParamChange(page, "week", previousWeek);
            await waitForMainText(page, "THIS WEEK AT A GLANCE", 30000);
        });

        await runStep("Billing Trends Interaction", async () => {
            await page.goto(`${baseUrl}/?tab=trends`, { waitUntil: "domcontentloaded", timeout: 120000 });
            await waitForTab(page, "trends", "Billing Trends");
            await page.waitForSelector('svg[aria-label="Week-over-week billed hours trend"]', { timeout: 30000 });
            const startingWeek = await getUrlSearchParam(page, "week");
            await clickByAriaLabel(page, "Previous week");
            await waitForUrlSearchParamChange(page, "week", startingWeek);
            const previousWeek = await getUrlSearchParam(page, "week");
            await clickByExactText(page, null, "Current Week");
            await waitForUrlSearchParamChange(page, "week", previousWeek);
            await waitForMainText(page, "WEEK-OVER-WEEK TREND TABLE", 30000);
        });

        await runStep("Capacity Trends Interaction", async () => {
            await page.goto(`${baseUrl}/?tab=capacity-trends`, { waitUntil: "domcontentloaded", timeout: 120000 });
            await waitForTab(page, "capacity-trends", "Capacity Trends");
            await page.waitForSelector('svg[aria-label="Week-over-week utilization trend"]', { timeout: 30000 });
            const startingWeek = await getUrlSearchParam(page, "week");
            await clickByAriaLabel(page, "Previous week");
            await waitForUrlSearchParamChange(page, "week", startingWeek);
            const previousWeek = await getUrlSearchParam(page, "week");
            await clickByExactText(page, null, "Current Week");
            await waitForUrlSearchParamChange(page, "week", previousWeek);
            await waitForMainText(page, "OVERALL UTILIZATION", 30000);
        });

        await runStep("Consultant Utilization CRUD", async () => {
            await page.goto(`${baseUrl}/?tab=consultant-utilization`, { waitUntil: "domcontentloaded", timeout: 120000 });
            await waitForTab(page, "consultant-utilization", "Consultant Utilization");
            console.log("[smoke] Consultant Utilization -> opened screen");
            await clickByExactText(page, null, "Add Consultant");
            await page.waitForFunction(
                () => document.body?.textContent?.includes("Save Consultant"),
                { timeout: 30000 }
            );
            console.log("[smoke] Consultant Utilization -> opened add modal");
            const uniqueSuffix = `${Date.now()}`;
            await typeIntoField(page, 'input[placeholder="Jane"]', `Smoke${uniqueSuffix}`);
            await typeIntoField(page, 'input[placeholder="Doe"]', "Tester");
            await typeIntoField(page, 'input[placeholder="jane.doe@company.com"]', `smoke.${uniqueSuffix}@example.com`);
            await clickByExactText(page, null, "Save Consultant");
            console.log("[smoke] Consultant Utilization -> submitted add consultant");
            await page.waitForFunction(
                (name) => document.body?.textContent?.includes(name),
                { timeout: 30000 },
                `Smoke${uniqueSuffix} Tester`
            );
            console.log("[smoke] Consultant Utilization -> consultant visible");
            await clickByTextContains(page, "Removed (");
            await page.waitForFunction(
                () => {
                    const button = Array.from(document.querySelectorAll("button")).find((element) =>
                        String(element.textContent || "").includes("Removed (")
                    );
                    return Boolean(button && String(button.className).includes("bg-surface-hover"));
                },
                { timeout: 30000 }
            );
            console.log("[smoke] Consultant Utilization -> removed tab active");
            await clickByTextContains(page, "Active (");
            await waitForMainText(page, "CONSULTANT UTILIZATION", 30000);
            console.log("[smoke] Consultant Utilization -> active tab restored");
        });

        await runStep("Timesheets Interaction", async () => {
            const timesheetsUrl = boardAssignee
                ? `${baseUrl}/?tab=timesheets&assignee=${encodeURIComponent(boardAssignee)}`
                : `${baseUrl}/?tab=timesheets`;
            await page.goto(timesheetsUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
            await waitForTab(page, "timesheets", "Timesheets");
            const nextConsultant = await selectDifferentOption(page, "select");
            if (nextConsultant) {
                await page.waitForFunction(
                    (expected) => new URL(window.location.href).searchParams.get("assignee") === expected,
                    { timeout: 30000 },
                    nextConsultant
                );
            }
            const startingWeek = await getUrlSearchParam(page, "week");
            await clickByAriaLabel(page, "Previous week");
            await waitForUrlSearchParamChange(page, "week", startingWeek);
            await waitForMainText(page, "Remaining To Bill", 30000);
        });

        await runStep("Settings Page", async () => {
            await clickByExactText(page, null, "Settings");
            await waitForMainText(page, "User Access", 30000);
        });

        await runStep("Back To Main Menu", async () => {
            await clickByExactText(page, null, "Back To Main Menu");
            await waitForMainText(page, "Command Center", 30000);
        });

        await runStep("Capacity Grid -> Editable Tasks", async () => {
            await page.goto(`${baseUrl}/?tab=capacity-grid`, { waitUntil: "domcontentloaded", timeout: 120000 });
            console.log(`[smoke] Capacity Grid direct load -> ${page.url()}`);
            await waitForTab(page, "capacity-grid", "Capacity Grid");
            const openedBoard = await clickFirstTaskBoardButton(page);
            assert(openedBoard, "No Capacity Grid task board buttons were available to test");
            console.log(`[smoke] Task board click -> ${page.url()}`);
            boardAssignee = await getUrlSearchParam(page, "assignee");
            await waitForTab(page, "issues", "Editable Tasks");
        });

        await runStep("Editable Task Creation", async () => {
            const beforeText = await readMainText(page);
            const beforeCount = parseEditableTaskCount(beforeText);
            await clickByExactText(page, null, "Add Task");
            await waitForMainText(page, "New Task", 30000);
            const afterText = await readMainText(page);
            const afterCount = parseEditableTaskCount(afterText);
            assert(
                (beforeCount !== null && afterCount !== null && afterCount === beforeCount + 1) || afterText.includes("New Task"),
                "Add Task did not create a visible task in the editable board"
            );
        });

        const centeredEditorVisible = await page.evaluate(() => {
            const closeButton = Array.from(document.querySelectorAll("button")).find(
                (element) => String(element.getAttribute("aria-label") || "").trim() === "Close task editor"
            );
            return Boolean(closeButton);
        });
        if (centeredEditorVisible) {
            await clickByExactText(page, null, "Close task editor");
        }

        await runStep("Editable Tasks -> Capacity Grid", async () => {
            const returnToHref = await page.evaluate(() => {
                const params = new URLSearchParams(window.location.search);
                return params.get("returnTo");
            });
            assert(returnToHref, "Editable task board did not preserve a returnTo link back to Capacity Grid");
            await page.goto(new URL(returnToHref, baseUrl).toString(), {
                waitUntil: "domcontentloaded",
                timeout: 120000,
            });
            await waitForTab(page, "capacity-grid", "Capacity Grid");
        });

        await runStep("Capacity Grid Note Editor", async () => {
            await page.goto(`${baseUrl}/?tab=capacity-grid`, { waitUntil: "domcontentloaded", timeout: 120000 });
            await waitForTab(page, "capacity-grid", "Capacity Grid");
            await openFirstCapacityGridNoteEditor(page);
            await page.waitForFunction(
                () => document.body?.textContent?.includes("Save Note"),
                { timeout: 30000 }
            );
            const noteValue = `Smoke note ${Date.now()}`;
            await setInputValue(page, "textarea", noteValue);
            await clickByExactText(page, null, "Save Note");
            await page.waitForFunction(
                (text) => !document.body?.textContent?.includes("Planning Context") || !document.querySelector("textarea"),
                { timeout: 30000 },
                noteValue
            );
            await openFirstCapacityGridNoteEditor(page);
            await page.waitForFunction(
                (text) => {
                    const area = document.querySelector("textarea");
                    return area instanceof HTMLTextAreaElement && area.value === text;
                },
                { timeout: 30000 },
                noteValue
            );
            await clickByExactText(page, null, "Cancel");
        });

        await runStep("Client Setup CRUD", async () => {
            await page.goto(`${baseUrl}/?tab=client-setup`, { waitUntil: "domcontentloaded", timeout: 120000 });
            await waitForTab(page, "client-setup", "Client Setup");
            await clickByExactText(page, null, "Add Client");
            const uniqueName = `Smoke Client ${Date.now()}`;
            await typeIntoField(page, '[data-client-row^="new-"] input[placeholder="Client name"]', uniqueName);
            await typeIntoField(page, '[data-client-row^="new-"] input[placeholder="1"]', "9");
            await typeIntoField(page, '[data-client-row^="new-"] input[placeholder="Managed Service"]', "Smoke Deal");
            await typeIntoField(page, '[data-client-row^="new-"] td:nth-child(5) input', "8");
            await typeIntoField(page, '[data-client-row^="new-"] td:nth-child(6) input', "12");
            await clickNewClientRowSave(page);
            await page.waitForFunction(
                (name) => document.body?.textContent?.includes(name),
                { timeout: 30000 },
                uniqueName
            );
        });

        await runStep("Backlog Growth Drilldown", async () => {
            await page.goto(`${baseUrl}/?tab=backlog-growth`, { waitUntil: "domcontentloaded", timeout: 120000 });
            await waitForTab(page, "backlog-growth", "Backlog Growth");
            await selectDifferentOption(page, "select");
            await clickFirstBacklogSegment(page);
            await page.waitForFunction(
                () => {
                    const text = document.body?.textContent || "";
                    return text.includes("Existing backlog") || text.includes("New work added in month");
                },
                { timeout: 30000 }
            );
        });

        const bodyText = await readBodyText(page);
        assert(!bodyText.includes("Server Error"), "Encountered a Next.js server error overlay during smoke testing");

        if (issues.pageErrors.length > 0) {
            throw new Error(`Page errors detected:\n${issues.pageErrors.join("\n")}`);
        }
        if (issues.serverResponses.length > 0) {
            throw new Error(`Server 5xx responses detected:\n${issues.serverResponses.join("\n")}`);
        }

        return results;
    } catch (error) {
        if (error instanceof Error) {
            error.message = `Step failed: ${currentStep}\n${error.message}`;
        }
        throw error;
    }
}

async function main() {
    const issues = {
        consoleErrors: [],
        consoleWarnings: [],
        pageErrors: [],
        serverResponses: [],
    };

    let browser = null;
    let page = null;
    let server = null;
    let tempDir = null;
    let screenshotDir = null;
    let originalTsconfig = null;

    try {
        screenshotDir = await mkdtemp(path.join(os.tmpdir(), "mission-control-smoke-artifacts-"));
        originalTsconfig = await readFile(path.join(repoRoot, "tsconfig.json"), "utf8");

        if (!reuseServer) {
            const isolatedDb = await createIsolatedDbCopy();
            tempDir = isolatedDb.tempDir;
            await syncIsolatedDbSchema(isolatedDb.databaseUrl);
            await buildApp(isolatedDb.databaseUrl);
            server = startServer(isolatedDb.databaseUrl);
            await waitForServer(baseUrl, 120000);
        }

        browser = await puppeteer.launch({
            headless,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1600, height: 1000 });
        page.setDefaultTimeout(20000);
        page.setDefaultNavigationTimeout(120000);

        page.on("console", (message) => {
            const text = message.text();
            const type = message.type();
            if (type === "error" && !text.includes("favicon.ico")) {
                issues.consoleErrors.push(text);
            } else if (type === "warning") {
                issues.consoleWarnings.push(text);
            }
        });
        page.on("pageerror", (error) => {
            issues.pageErrors.push(error.message);
        });
        page.on("response", (response) => {
            if (response.status() >= 500) {
                issues.serverResponses.push(`${response.status()} ${response.url()}`);
            }
        });

        const results = await runSmoke(page, issues);

        console.log("\n[smoke] Completed smoke coverage:");
        for (const result of results) {
            console.log(`[smoke]   PASS ${result.name}`);
        }

        if (issues.consoleWarnings.length > 0) {
            console.log("\n[smoke] Browser warnings observed:");
            for (const warning of issues.consoleWarnings) {
                console.log(`[smoke]   WARN ${warning}`);
            }
        }

        if (issues.consoleErrors.length > 0) {
            console.log("\n[smoke] Browser console errors observed:");
            for (const error of issues.consoleErrors) {
                console.log(`[smoke]   ${strictConsole ? "FAIL" : "WARN"} ${error}`);
            }
            if (strictConsole) {
                throw new Error("Unexpected browser console errors were emitted during smoke testing");
            }
        }

        console.log(`\n[smoke] Smoke suite passed against ${baseUrl}`);
    } catch (error) {
        const screenshotPath = screenshotDir ? path.join(screenshotDir, "smoke-failure.png") : null;
        if (page && screenshotPath) {
            try {
                await mkdir(path.dirname(screenshotPath), { recursive: true });
                await page.screenshot({ path: screenshotPath, fullPage: true });
            } catch {
                // Ignore screenshot failures during cleanup.
            }
        }

        console.error("\n[smoke] Smoke suite failed.");
        if (error instanceof Error) {
            console.error(`[smoke] ${error.message}`);
        } else {
            console.error(`[smoke] ${String(error)}`);
        }
        if (screenshotPath) {
            console.error(`[smoke] Failure screenshot: ${screenshotPath}`);
        }
        if (serverStdout.length > 0) {
            console.error("\n[smoke] Recent dev server output:");
            for (const line of serverStdout.slice(-30)) console.error(line);
        }
        if (serverStderr.length > 0) {
            console.error("\n[smoke] Recent dev server stderr:");
            for (const line of serverStderr.slice(-30)) console.error(line);
        }
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        if (server) await stopServer(server);
        if (originalTsconfig !== null) {
            await writeFile(path.join(repoRoot, "tsconfig.json"), originalTsconfig, "utf8");
        }
        if (!reuseServer) {
            await rm(path.join(repoRoot, smokeDistDir), { recursive: true, force: true });
        }
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
        }
    }
}

await main();
