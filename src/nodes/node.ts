import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import { delay } from "../utils";
import axios from 'axios';

export async function node(
    nodeId: number, // the ID of the node
    N: number, // total number of nodes in the network
    F: number, // number of faulty nodes in the network
    initialValue: Value, // initial value of the node
    isFaulty: boolean, // true if the node is faulty, false otherwise
    nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
    setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  type NodeState = {
    killed: boolean; // this is used to know if the node was stopped by the /stop route. It's important for the unit tests but not very relevant for the Ben-Or implementation
    x: 0 | 1 | "?" | null; // the current consensus value
    decided: boolean | null; // used to know if the node reached finality
    k: number | null; // current step of the node
  };

  let currentNodeState: NodeState = {
    killed: false,
    x: null,
    decided: null,
    k: null,
  }

  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  //Fonction qui permet d'envoyer les messages à tous les nodes
  async function broadcastMessage(k: number, x: Value, phase: string) {
    for (let i = 0; i < N; i++) {
      axios.post(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        k: k,
        x: x,
        phase: phase
      });
    }
  }

  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  node.get("/getState", (req, res) => {
    if (currentNodeState){
      res.status(200).json(currentNodeState);
    }
  });

  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(50);
    }

    if (!isFaulty) {
      currentNodeState.k = 1;
      currentNodeState.x = initialValue;
      currentNodeState.decided = false;

      broadcastMessage(currentNodeState.k, currentNodeState.x, 'Phase: 1');
    }
    
    res.status(200).send("Ben-Or Consensus Algorithme started");
  });

  node.get("/stop", (req, res) => {
    currentNodeState.killed = true;
    res.status(200).send("Node killed");
  });

  node.post("/message", async (req, res) => {
    let { k, x, phase } = req.body;

    if (!isFaulty && !currentNodeState.killed) {

      if (phase == "Phase: 1") {
        if (!proposals.has(k)){
          proposals.set(k, []);
        }
        
        proposals.get(k)!.push(x);
        let proposal = proposals.get(k)!;

        if (proposal.length >= (N - F)) {
          let count0_Phase1 = proposal.filter((value) => value == 0).length;
          let count1_Phase1 = proposal.filter((value) => value == 1).length;

          let new_x: 0 | 1 | "?" | null;
          if (count0_Phase1 > N/2) {
            new_x = 0;
          } 
          else if (count1_Phase1 > N/2) {
            new_x = 1;
          }
          else {
            new_x = "?";
          }

          await broadcastMessage(k, new_x, 'Phase: 2');
        }
      }
      
      if (phase == "Phase: 2") {
        if (!votes.has(k)) {
          votes.set(k, []);
        }

        votes.get(k)!.push(k);
        let vote = votes.get(k)!;

        if (vote.length >= (N - F)) {
          let count0_Phase2 = vote.filter((value) => value == 0).length;
          let count1_Phase2 = vote.filter((value) => value == 1).length;

          let new_x: 0 | 1 | "?" | null;
          let new_decided: boolean | null = currentNodeState.decided;

          if (count0_Phase2 >= F + 1) {
            new_x = 0;
            new_decided = true;

            currentNodeState.x = new_x;
            currentNodeState.decided = new_decided;
          } 
          else if (count1_Phase2 >= F + 1) {
            new_x = 1;
            new_decided = true;

            currentNodeState.x = new_x;
            currentNodeState.decided = new_decided;
          } 
          else {
            if (count0_Phase2 + count1_Phase2 == 0) {
              new_x = Math.random() > 0.5 ? 1 : 0;
            } 
            else {
              if (count0_Phase2 > count1_Phase2) {
                new_x = 0;
              }
              else {
                new_x = 1;
              }
            }

            currentNodeState.k = k + 1;
            currentNodeState.x = new_x;
            currentNodeState.decided = new_decided;

            if (currentNodeState.k) {
              broadcastMessage(currentNodeState.k, currentNodeState.x, 'Phase: 1');
            }
          }
        }
      }
    }
    res.status(200).send("Message received and processed.");
  });

  // Start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}
