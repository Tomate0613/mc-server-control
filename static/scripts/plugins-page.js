// eslint-disable-next-line no-unused-vars
function remove(plugin) {
    const request = new XMLHttpRequest();
    request.open('DELETE', `/api/server/${document.getElementById('box').dataset.id}/plugins/${plugin}`);
    request.send();
    request.addEventListener('load', () => {
        const response = JSON.parse(request.responseText);
        const status = response.status;
        const message = response.message;
        if (status === 'ERROR') {
            createModal('Error', message);
        } else {
            location.reload();
        }
    });
}