const socket = io();

socket.on('mods', function (data) {
    document.getElementById('install-mods').innerHTML = '';
    for (let i = 0; i < data.hits.length; i++) {
        let mod = data.hits[i];
        let modDiv = document.createElement('div');
        modDiv.className = 'mod';
        modDiv.innerHTML = `
        <image class="mod-icon" src="${mod.icon_url}"></image>
        <div class="mod-info">
            <h2 class="mod-name">${mod.title}</h2>
            <div class="mod-author">${mod.author}</div>
            <div class="mod-description">${mod.description}</div>
            <div class="mod-buttons">
                <input type="button" class="btn" onclick="download('${mod.slug}')" value="Install"></input>
            </div>
        </div>
        `;
        document.getElementById('install-mods').appendChild(modDiv);
    }
});

socket.on('mod_list', (data) => {
    document.getElementById('installed-mods').innerHTML = '';
    for (let i = 0; i < data.length; i++) {
        let mod = data[i];
        let modDiv = document.createElement('div');
        modDiv.className = 'mod';
        modDiv.tabIndex = 0;
        modDiv.innerHTML = `
        <image class="mod-icon" src="${mod.icon_url}"></image>
            <div class="mod-info">
                <h2 class="mod-name">${mod.title}</h2>
                <div class="mod-description">${mod.description}</div>
                <div class="mod-body">${mod.body}</div>
                <div class="mod-buttons">
                    <input type="button" class="btn btn-danger" onclick="remove('${mod.file}')" value="Remove"></input>
                </div>
            </div>
        `;
        document.getElementById('installed-mods').appendChild(modDiv);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const modSearch = document.getElementById('mod-search');
    const version = document.getElementById('container').dataset.version;

    socket.emit('search_mods', modSearch.value, version);

    modSearch.addEventListener('change', () => {
        socket.emit('search_mods', modSearch.value, version);
    });

    modSearch.addEventListener('input', () => {
        socket.emit('search_mods', modSearch.value, version);
    });
});

// eslint-disable-next-line no-unused-vars
function download(slug) {
    const request = new XMLHttpRequest();
    const server = document.getElementById('container').dataset.id;

    request.open('POST', `/api/server/${server}/mods/${slug}`);
    request.send();

    request.addEventListener('load', function() {
        const response = JSON.parse(request.responseText);
        const status = response.status;

        if (status === 'ERROR') {
            createModal('Error', `${response.message}`);
        }
    });
}

// eslint-disable-next-line no-unused-vars
function remove(filename) {
    const request = new XMLHttpRequest();
    const server = document.getElementById('container').dataset.id;

    request.open('DELETE', `/api/server/${server}/mods/${filename}`);
    request.send();

    request.addEventListener('load', function() {
        const response = JSON.parse(request.responseText);
        const status = response.status;

        if (status === 'ERROR') {
            createModal('Error', `${response.message}`);
        }
    });
}