const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const convertTweetDbObjectToResponseObject = (dbObject) => {
  return {
    username: dbObject.username,
    tweet: dbObject.tweet,
    dateTime: dbObject.date_time,
  };
};
const convertLikesDbObjectToResponseObject = (dbObjects) => {
  let likes = [];
  for (let likeObj of dbObjects) {
    likes.push(likeObj.username);
  }
  return {
    likes: likes,
  };
};

const convertUserDbObjectToResponseObject = (dbObject) => {
  return {
    name: dbObject.username,
  };
};

const convertUserTweetObjToResponseObject = (dbObject) => {
  return {
    tweet: dbObject.tweet,
    likes: dbObject.likes,
    replies: dbObject.replies,
    dateTime: dbObject.date_time,
  };
};

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
}

app.post("/register/", async (request, response) => {
  const { username, name, password, gender, location } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const userQuery = `SELECT * FROM user WHERE username='${username}'`;

  const userObj = await database.get(userQuery);
  if (userObj !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length <= 5) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const postQuery = `INSERT INTO user (username, name, password, gender) 
            VALUES (
            '${username}', 
            '${name}',
            '${hashedPassword}', 
            '${gender}'
        )`;
      await database.run(postQuery);
      response.status(200);
      response.send("User created successfully");
    }
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const databaseUser = await database.get(selectUserQuery);
  if (databaseUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      databaseUser.password
    );
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const getFeedQuery = `
  SELECT * FROM (user INNER JOIN follower on user.user_id=following_user_id)AS T INNER JOIN tweet ON tweet.user_id=T.following_user_id WHERE t.follower_user_id=${dbUser.user_id} ORDER BY date_time DESC LIMIT 4;
  `;
  const tweets = await database.all(getFeedQuery);
  response.send(
    tweets.map((eachTweet) => convertTweetDbObjectToResponseObject(eachTweet))
  );
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;

  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const getFeedQuery = `
  SELECT name FROM user
    INNER JOIN follower on user.user_id=following_user_id
  WHERE follower_user_id=${dbUser.user_id};
  `;
  const tweets = await database.all(getFeedQuery);
  response.send(tweets);
  convertLikesDbObjectToResponseObject;
});
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;

  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const getFeedQuery = `
  SELECT name FROM user INNER JOIN follower on user_id=follower_user_id WHERE following_user_id=${dbUser.user_id};
  `;
  const tweets = await database.all(getFeedQuery);
  response.send(tweets);
});
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const getFeedQuery = `
  SELECT tweet AS tweet,tweet.date_time,follower_user_id,
    (SELECT COUNT(reply.tweet_id) FROM reply
        WHERE reply.tweet_id=${tweetId}) AS replies,
    (SELECT COUNT(like.tweet_id) FROM like
        WHERE like.tweet_id=${tweetId})AS likes FROM tweet 
    INNER JOIN follower ON tweet.user_id=following_user_id
  WHERE tweet.tweet_id=${tweetId};`;
  const tweetObj = await database.get(getFeedQuery);
  if (tweetObj) {
    response.send({
      tweet: tweetObj.tweet,
      likes: tweetObj.likes,
      replies: tweetObj.replies,
      dateTime: tweetObj.date_time,
    });
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
    const dbUser = await database.get(selectUserQuery);
    const likeQuery = `select username from follower
        inner join tweet on following_user_id=tweet.user_id
        inner join like on like.tweet_id=tweet.tweet_id
        inner join user on like.user_id=user.user_id where follower_user_id=${dbUser.user_id} 
        and tweet.tweet_id=${tweetId};`;

    const result = await database.all(likeQuery);
    if (result.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const myArray = result.map((item) => item.username);
      response.send({
        likes: myArray,
      });
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
    const dbUser = await database.get(selectUserQuery);
    const likeQuery = `select user.name,reply.reply from follower
        inner join tweet on following_user_id=tweet.user_id
        inner join reply on reply.tweet_id=tweet.tweet_id
        inner join user on reply.user_id=user.user_id where follower_user_id=${dbUser.user_id} 
        and tweet.tweet_id=${tweetId};`;

    const replies = await database.all(likeQuery);
    if (replies.length > 0) {
      response.send({
        replies: replies,
      });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const getFeedQuery = `
    select tweet,count() as likes,(
      select count() from tweet 
        inner join reply on tweet.tweet_id=reply.tweet_id 
      where tweet.user_id=${dbUser.user_id} group by tweet.tweet_id) as replies,
    tweet.date_time from tweet 
        inner join like on like.tweet_id=tweet.tweet_id 
    where tweet.user_id=${dbUser.user_id} group by tweet.tweet_id`;
  const tweetObjs = await database.all(getFeedQuery);
  response.send(
    tweetObjs.map((eachTweet) => convertUserTweetObjToResponseObject(eachTweet))
  );
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const postQuery = `INSERT INTO tweet (user_id,tweet) values(${dbUser.user_id},'${tweet}');`;
  await database.run(postQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const tweetQuery = `SELECT * FROM user INNER JOIN tweet ON tweet.user_id=user.user_id WHERE username = '${username}' AND tweet.tweet_id=${tweetId};`;
    const tweetObj = await database.get(tweetQuery);
    if (!tweetObj) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteQuery = `DELETE FROM tweet WHERE tweet_id=${tweetId};`;
      await database.run(deleteQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
