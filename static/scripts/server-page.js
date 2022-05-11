let id = -1;
const socket = io();

socket.on('connect', function () {
    console.log('Connected to server');
});

socket.on('server_logs', (logs) => {
    if (logs.server === id) {
        document.getElementById('logs').innerText = logs.data;
        //TODO Markup

        //scroll to bottom of page
        document.getElementById('logs').scrollTo(0, document.getElementById('logs').scrollHeight);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    id = document.getElementById('box').dataset.id;
    document.getElementById('change-name').addEventListener('click', () => {
        createModal('Change Name', `<form><input type="text" id="new-name" value="${document.getElementById('server-name').innerText}"><input type="submit" value="Submit" class="btn"></form>`).addEventListener('click', () => {
            event.preventDefault();
            if (!event.target.classList.contains('btn'))
                return;

            let value = document.getElementById('new-name').value;

            let body = { value };
            const request = new XMLHttpRequest();
            request.open('POST', `/api/server/${id}/change/name`);
            request.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
            request.send(JSON.stringify(body));

            request.addEventListener('load', function () {
                const response = JSON.parse(request.responseText);
                const status = response.status;

                if (status === 'OK') {
                    document.getElementById('background').remove();
                    document.getElementById('server-name').innerText = value;
                } else {
                    console.error(request.response);
                }
            });
        });
    });

    document.getElementById('change-version').addEventListener('click', () => {
        createModal('Change version', `<form><input type="text" id="new-version" value="${document.getElementById('server-version').innerText}"><input type="submit" value="Submit" class="btn"></form>`).addEventListener('click', () => {
            event.preventDefault();
            if (!event.target.classList.contains('btn'))
                return;

            let value = document.getElementById('new-version').value;

            let body = { value };
            const request = new XMLHttpRequest();
            request.open('POST', `/api/server/${id}/change/version`);
            request.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
            request.send(JSON.stringify(body));

            request.addEventListener('load', function () {
                const response = JSON.parse(request.responseText);
                const status = response.status;

                if (status === 'OK') {
                    document.getElementById('background').remove();
                    document.getElementById('server-version').innerText = value;
                } else {
                    console.error(request.response);
                }
            });
        });
    });

    document.getElementById('start-server').addEventListener('click', () => {
        event.target.blur();
        let request = new XMLHttpRequest();
        request.open('POST', `/api/server/${id}/start`);
        request.send();
        request.addEventListener('load', function() {
            const response = JSON.parse(request.responseText);
            const status = response.status;
            const message = response.message;

            if (status === 'OK') {
                createModal('Starting server', 'Server is now starting');
            } else if (status === 'ERROR') {
                createModal('Error', message);
            }
        });
    });

    document.getElementById('stop-server').addEventListener('click', () => {
        event.target.blur();
        let request = new XMLHttpRequest();
        request.open('POST', `/api/server/${id}/stop`);
        request.send();
        request.addEventListener('load', function() {
            const response = JSON.parse(request.responseText);
            const status = response.status;
            const message = response.message;

            if (status === 'OK') {
                createModal('Stopping server', 'Server has been stopped');
            } else if (status === 'ERROR') {
                createModal('Error', message);
            }
        });
    });

    document.getElementById('submit').addEventListener('click', () => {
        event.preventDefault();
        socket.emit('server_cmd', {command: document.getElementById('input').value, id});
        document.getElementById('input').value = '';
    });

    //Send something so the server respondes
    socket.emit('server_cmd', {id, command: 'list'}); //!HACK
});