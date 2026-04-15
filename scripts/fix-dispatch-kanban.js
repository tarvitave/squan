const fs = require('fs');
const f = 'server/src/index.ts';
let c = fs.readFileSync(f, 'utf8');

// Find the project dispatch endpoint and add auto-RT creation
// Pattern: spawnDirectAgent(req.params.projectId, (taskDescription ?? task) || 'No task specified', userId)
//          res.json(bee)

const oldDispatch1 = `const bee = await spawnDirectAgent(req.params.projectId, (taskDescription ?? task) || 'No task specified', userId)
    res.json(bee)
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})
app.post('/api/rigs/:rigId/polecats'`;

const newDispatch1 = `const taskText = (taskDescription ?? task) || 'No task specified'
    const bee = await spawnDirectAgent(req.params.projectId, taskText, userId)
    // Auto-create release train so agent appears on kanban board
    const rt = await releaseTrainManager.create(taskText.slice(0, 80), req.params.projectId, [], taskText, userId)
    await releaseTrainManager.assignWorkerBee(rt.id, bee.id)
    await releaseTrainManager.start(rt.id)
    broadcastEvent({ id: randomUUID(), type: 'releasetrain.created', payload: rt, timestamp: new Date().toISOString() })
    res.json({ ...bee, releaseTrainId: rt.id })
  } catch (err) { res.status(400).json({ error: (err as Error).message }) }
})
app.post('/api/rigs/:rigId/polecats'`;

if (c.includes(oldDispatch1)) {
  c = c.replace(oldDispatch1, newDispatch1);
  console.log('Updated project dispatch endpoint');
} else {
  console.log('Could not find project dispatch pattern');
}

// Same for the rigs endpoint
const oldDispatch2 = `const bee = await spawnDirectAgent(req.params.rigId, (taskDescription ?? task) || 'No task specified', userId)
    res.json(bee)`;

const newDispatch2 = `const taskText2 = (taskDescription ?? task) || 'No task specified'
    const bee = await spawnDirectAgent(req.params.rigId, taskText2, userId)
    // Auto-create release train so agent appears on kanban board
    const rt2 = await releaseTrainManager.create(taskText2.slice(0, 80), req.params.rigId, [], taskText2, userId)
    await releaseTrainManager.assignWorkerBee(rt2.id, bee.id)
    await releaseTrainManager.start(rt2.id)
    broadcastEvent({ id: randomUUID(), type: 'releasetrain.created', payload: rt2, timestamp: new Date().toISOString() })
    res.json({ ...bee, releaseTrainId: rt2.id })`;

if (c.includes(oldDispatch2)) {
  c = c.replace(oldDispatch2, newDispatch2);
  console.log('Updated rigs dispatch endpoint');
} else {
  console.log('Could not find rigs dispatch pattern');
}

fs.writeFileSync(f, c);
console.log('Done');
