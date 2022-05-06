let socket = io();

socket.on('connect', function() {
    console.log('Connected to server');
});

socket.on('update_server_list', (servers) => {
    const list = document.getElementById('list');
    list.innerHTML = '';

    servers.forEach((server) => {
        let icon = '';
        switch(server.status){
            case 'stopped' :
                icon = '<span class="iconify" data-icon="mdi-octagon">🛑</span>';
            break;
            case 'starting' :
                icon = '<span class="iconify mdi-spin" data-icon="mdi-loading">🔄</span>';
            break;
            case 'running' :
                icon = '<span class="iconify" data-icon="mdi-server">💻</span>';
            break;
            case 'error' :
                icon = '<span class="iconify" data-icon="mdi-alert-circle">⚠</span>';
            break;
            case 'creating' :
                icon = '<span class="iconify mdi-spin" data-icon="mdi-progress-download">🔽</span>';
            break;
            case 'default' :
                icon = '<span class="iconify" data-icon="mdi-alert-circle">⚠</span>';
            break;
        }

        const serverItem = document.createElement('div');
        serverItem.classList.add('server-item');
        serverItem.classList.add(`server-status-${server.status}`);
        serverItem.tabIndex = 0;
        serverItem.dataset.id = server.id;
        serverItem.innerHTML = `
        <div class="server-info">
            <h2 class="server-name">${server.name}</h2>
            <span class="text-secondary text-smaller">${server.id}</span> - 
            <span class="text-secondary text-smaller">${server.software}</span>
        </div>
        <div class="server-status">
            ${icon}
        </div>
        <div class="server-actions"><span data-id="${ server.id }" class="start-server"><span class="iconify" data-icon="mdi-play">▶</span></span> <span class="stop-server" data-id="${ server.id }"><span class="iconify" data-icon="mdi-stop">🟥</span></span> <span class="delete-server" data-id="${ server.id }" data-name="${ server.name }"><span class="iconify" data-icon="mdi-delete">❌</span></span></div>
        `;
        list.appendChild(serverItem);
    });

    if(servers.length === 0) { 
        list.innerHTML = '<div class="server-item">No servers here ;-;</div>';
    }

    updateActions();
});

document.addEventListener('DOMContentLoaded', () => {
    //EULA
    if(document.getElementById('box').dataset.eula === 'false')
        createModal('EULA', `
            <form>
                <div class="form-group">
                    You need to accept the mincraft eula in the <code>config.json</code> file and restart the server
                </div>
                <div class="form-group">
                    <input type="submit" class="btn" value="RETRY">
                </div>
            </form>
        `, true);


    //Add server button
    document.getElementById('add-server-button').addEventListener('click', () => {
        createModal('Add Server',`
            <form id="add-server-form">
                <div class="form-group">
                    <label for="server-name">Server Name</label>
                    <input type="text" class="form-control" id="server-name" placeholder="Server Name">
                </div>
                <div class="form-group">
                    <label for="server-software">Server Software</label>
                    <select id="server-software">
                        <option>Vanilla</option>
                        <option>Paper</option>
                        <option>Fabric</option>
                    </select>
                <div class="form-group">
                    <input type="submit" class="btn form-control" id="submit-add-server-modal" value="Create">
                </div>
            </form>
        `).addEventListener('submit', () => {
            event.preventDefault();
            console.log(event);

            const request = new XMLHttpRequest();

            const body = {
                name: document.getElementById('server-name').value,
                software: document.getElementById('server-software').value,
            };

            request.open('POST', `/api/server/`);
            request.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
            request.send(JSON.stringify(body));
            
            request.addEventListener('load', function(e) {
                const response = JSON.parse(request.responseText);
                const status = response.status;

                if (status === 'OK') {
                    document.getElementById('background').remove();
                } else {
                    console.error(request.response);
                }
            });
        });
    });

    //Drag and drop server upload
    document.body.addEventListener('dragover', () => {
        event.preventDefault();
    });

    document.body.addEventListener('drop', () => {
        event.preventDefault();

        const files = event.dataTransfer.files;

        let formData = new FormData();

        const file = files[0];

        if(file.type !== 'application/x-zip-compressed')
            return;

        formData.append('upload', file, file.name);

        const request = new XMLHttpRequest();

        request.open('POST', '/api/server/upload');
        request.send(formData);
    });

    updateActions();
});

function updateActions(){
    const starts = document.getElementsByClassName('start-server');

    for(let i = 0; i < starts.length; i++){
        starts.item(i).addEventListener('click', function (e){
            event.target.blur();
            let request = new XMLHttpRequest();
            request.open('POST', `/api/server/${event.currentTarget.dataset.id}/start`);
            request.send();
            request.addEventListener('load', function() {
                const response = JSON.parse(request.responseText);
                const status = response.status;
                const message = response.message;

                if(status === 'OK'){
                    createModal('Starting server', 'Server is now starting');
                }else if(status === 'ERROR'){
                    createModal('Error', message);
                }
            });
        });
    }

    const stops = document.getElementsByClassName('stop-server');

    for(let i = 0; i < stops.length; i++){
        stops.item(i).addEventListener('click', function (e){
            event.target.blur();
            let request = new XMLHttpRequest();
            request.open('POST', `/api/server/${event.currentTarget.dataset.id}/stop`);
            request.send();
            request.addEventListener('load', function() {
                const response = JSON.parse(request.responseText);
                const status = response.status;
                const message = response.message;

                if(status === 'OK'){
                    createModal('Stopping server', 'Server is now shutting down');
                }else if(status === 'ERROR'){
                    createModal('Error', message);
                }
            });
        });
    }

    const deletes = document.getElementsByClassName('delete-server');

    for(let i = 0; i < deletes.length; i++){
        deletes.item(i).addEventListener('click', function (e){
            const dataset = e.currentTarget.dataset;
            createModal('Delete Server', `
            <form id="delete-server-form">
                Do you really want to delete "${dataset.name}"
                <div class="form-group">
                    <input type="submit" class="btn form-control" id="submit-add-server-modal" value="Delete">
                    <input type="button" class="btn form-control" value="Cancel" onclick="document.getElementById('background').remove()">
                </div>
             </form>
            `).addEventListener('submit', () => {
                event.preventDefault();
                document.getElementById('background').remove();
                let request = new XMLHttpRequest();
                request.open('DELETE', `/api/server/${dataset.id}`);
                request.send();
                request.addEventListener('load', function() {
                    const response = JSON.parse(request.responseText);
                    const status = response.status;
                    const message = response.message;

                    if(status === 'OK'){
                        createModal('Deleted server', 'Server has been deleted');
                    }else if(status === 'ERROR'){
                        createModal('Error', message);
                    }
                });
            });
        });
    }

    const items = document.getElementsByClassName('server-item');

    for(let i = 0; i < items.length; i++){
        items.item(i).addEventListener('click', function (e){
            if(!event.target.offsetParent)
                return;
            document.location.href = `/servers/${event.currentTarget.dataset.id}`;
        });
    }
}