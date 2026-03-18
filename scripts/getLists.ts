import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
    console.log("Fetching Folders in PS Workspace...");
    const res = await fetch('https://api.clickup.com/api/v2/space/90171692986/folder', {
        headers: { 'Authorization': process.env.CLICKUP_API_KEY as string }
    });
    const data = await res.json();
    console.log("Folders fetched. Lists:");

    // We also need Folderless lists!
    const folderlessRes = await fetch('https://api.clickup.com/api/v2/space/90171692986/list', {
        headers: { 'Authorization': process.env.CLICKUP_API_KEY as string }
    });
    const folderlessData = await folderlessRes.json();

    const lists: Array<{ id: string; name: string }> = [];
    if (data.folders) {
        data.folders.forEach((f: any) => {
            if (f.lists) {
                f.lists.forEach((l: any) => lists.push({ id: l.id, name: l.name }));
            }
        });
    }
    if (folderlessData.lists) {
        folderlessData.lists.forEach((l: any) => lists.push({ id: l.id, name: l.name }));
    }

    lists.forEach((l) => console.log(`${l.id} === ${l.name}`));
}

main().catch(console.error);
