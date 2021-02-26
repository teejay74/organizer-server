const http = require('http');
const fs = require('fs');
const path = require('path');
const WS = require('ws');
const Koa = require('koa');
const koaBody = require('koa-body');

const app = new Koa();
const port = process.env.PORT || 7171;

app.use(koaBody({
  urlencoded: true,
  multipart: true,
}));

// CORS
app.use(async (ctx, next) => {
  const origin = ctx.request.get('Origin');

  if (!origin) {
    return await next();
  }

  const headers = { 'Access-Control-Allow-Origin': '*', };

  if (ctx.request.method !== 'OPTIONS') {
    ctx.response.set({...headers});
    try {
      return await next();
    } catch (e) {
      e.headers = {...e.headers, ...headers};
      throw e;
    }
  }

  if (ctx.request.get('Access-Control-Request-Method')) {
    ctx.response.set({
      ...headers,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH',
    });

    if (ctx.request.get('Access-Control-Request-Headers')) {
      ctx.response.set('Access-Control-Allow-Headers', ctx.request.get('Access-Control-Allow-Request-Headers'));
    }

    ctx.response.status = 204;
  }
});

const server = http.createServer(app.callback()).listen(port);
const wsServer = new WS.Server({server});

let clients = [];
const ScrollPull = 10;
const pathToBD = './data/tasks.json';

wsServer.on('connection', (ws, req) => {
  clients.push(ws);

  ws.on('message', (msg) => {
    const request = JSON.parse(msg);

    const { method, data } = request;
    const response = { method, };
    response.data = {};
    const restClients = clients.filter((client) => client != ws);

    fs.readFile(pathToBD, (err, fd) => {
      const str = fd.toString();
      const serverState = JSON.parse(str);
      let tasksList;

      if(request.method === 'newTask') {
        serverState.tasksList.push(data);
        serverState.stateTask.timeLastStamp = data.timestamp;
        response.data.newTask = data;

        const toFile = JSON.stringify(serverState);
        fs.writeFile(pathToBD, toFile, () => {});

        restClients.forEach((client) => client.send(JSON.stringify(response)));
      }

      if (method === 'editTask') {
        let id = serverState.tasksList.findIndex((task) => task.id === data.id);
        serverState.tasksList[id] = data.task;
        restClients.forEach((client) => client.send(JSON.stringify(response)));

        const toFile = JSON.stringify(serverState);
        fs.writeFile(pathToBD, toFile, () => {});
        return;
      }

      if (method === 'deleteTask') {
        serverState.tasksList = serverState.tasksList.filter((task) => task.id !== data.id);
        restClients.forEach((client) => client.send(JSON.stringify(response)));

        const toFile = JSON.stringify(serverState);
        fs.writeFile(pathToBD, toFile, () => {});
        return;
      }

      if (method === 'switchPinnedOn') {       
        serverState.stateTask.attached = data.id;
        serverState.tasksList.find((task) => task.id === data.id).isPinned = true;
        restClients.forEach((client) => client.send(JSON.stringify(response))); 

        const toFile = JSON.stringify(serverState);
        fs.writeFile(pathToBD, toFile, () => {});
        return;       
      }

      if (method === 'switchPinnedOff') {
        serverState.stateTask.attached = null; 
        serverState.taskView = [];       
        serverState.tasksList.find(({ isPinned }) => isPinned).isPinned = false;
        restClients.forEach((client) => client.send(JSON.stringify(response)));

        const toFile = JSON.stringify(serverState);
        fs.writeFile(pathToBD, toFile, () => {});
        return;       
      }  

   
      if (method === 'getState') {
        const pinnedID = serverState.stateTask.attached;
        const pinnedTask = serverState.tasksList.find((task) => task.id === pinnedID);
          if (clients.length === 1) {
          tasksList = serverState.tasksList.slice(-ScrollPull);

          if (pinnedTask && !tasksList.includes(pinnedTask) ) {
            tasksList.unshift(pinnedTask);
          }

          tasksList.forEach((task) => task.loaded = true);
          const toFile = JSON.stringify(serverState);
          fs.writeFile(pathToBD, toFile, () => {});
        } else {
          tasksList = serverState.tasksList.filter(({ loaded }) => loaded);
        }

        response.data.buffer = {
          stateTask: serverState.stateTask,
          tasksList,
          taskView: serverState.taskView,
        };

       
        ws.send(JSON.stringify(response));
        return;
      }

      
    if (method === 'scrollTasks') {

      tasks = serverState.tasksList
        .filter(({ loaded }) => !loaded)
        .slice(-ScrollPull);

      if(!tasks.length) return;
      
      response.data = tasks;
      ws.send(JSON.stringify(response));
      restClients.forEach((client) => client.send(JSON.stringify(response)));

      tasks.forEach((task) => task.loaded = true);         
      const toFile = JSON.stringify(serverState);
      fs.writeFile(pathToBD, toFile, () => {});
      return;
    }

    });


  });

  ws.on('close', () => {
    clients = clients.filter((client) => client !== ws);

    if (clients.length) return;

    const file = fs.readFileSync(pathToBD);
    const str = file.toString();
    const serverState = JSON.parse(str);

    serverState.tasksList.forEach((task) => {
      task.loaded = false;
    });

    const toFile = JSON.stringify(serverState);
    fs.writeFile(pathToBD, toFile, () => {});
  });
});
