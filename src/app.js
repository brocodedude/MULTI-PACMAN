const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const createError = require('http-errors');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const multer = require('multer');

// Set up multer to store uploads in the 'uploads/' directory
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function(req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
  }
})

const upload = multer({ storage: storage })

// env vars
// this might look weird but trust me leave this alone
require('dotenv').config({path: '.env'}); // Load variables from .env file
require('dotenv').config({path: '../../.env'}); // Load variables from .env file if using cli

// routers
const indexRouter = require('./routes/index');
const gameRouter = require('./routes/game/game.controller');
const loginRouter = require('./routes/login/login.controller')
const lobbyRouter = require('./routes/lobby/lobby.controller')
const lobbyApiRouter = require('./routes/lobby_api/lobbyApi.controller');

// utils
const {initActiveLobbies} = require('./routes/game/game.service')
const isDocker = require('./utils/docker_check')

// core server
const {server, app} = require('./server')

// database
const db = require('./db/database');
const authTokenValidator = require("./middleware/auth_token_validator");
const {updateAuthToken, verifyAuthToken} = require("./routes/login/login.service");
require('dotenv').config({path:'.env'}); // Load variables from .env file
require('dotenv').config({path:'../../.env'}); // Load variables from .env file if using cli


app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(cookieParser());
const limiter = rateLimit({
    windowMs: parseInt(process.env.TIME_LIMIT) * 1000, // defined in .env
    limit: parseInt(process.env.REQUEST_LIMIT), // define in .env
})

app.use(limiter)

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});



app.use((req, res, next) => {
    const ext = path.extname(req.path);
    switch (ext) {
        case '.html':
            res.setHeader('Content-Type', 'text/html');
            break;
        case '.css':
            res.setHeader('Content-Type', 'text/css');
            break;
        case '.js':
            res.setHeader('Content-Type', 'text/javascript');
            break;
        
        // removing this. might interfere with multer.
        // case '.png':
        //     res.setHeader('Content-Type', 'image/png');
        //     break;
        // Add more cases as needed
        default:
            break;
    }
    next();
});

app.use(express.static(path.join(__dirname, '../public')));
app.use('/lobby/uploads', express.static(path.join(__dirname, '../uploads')));

// Route for IMAGES.
app.get('/images/:imageName', (req, res) => {
    const imageName = req.params.imageName;
    // res.setHeader('Content-Type', 'image/png');
    res.sendFile(path.join(__dirname, `../public/images/${imageName}`));
});

// Route for game assets.
app.get('/assets/:imageName', (req, res) => {
    const imageName = req.params.imageName;
    // res.setHeader('Content-Type', 'image/png');
    res.sendFile(path.join(__dirname, `../public/game/assets/${imageName}`));
});

// Route for register page.
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/auth/register.html'));
});

// logout
app.get('/logout', async (req, res) => {
    if (req.cookies.auth) {
        const result = await verifyAuthToken(req.cookies.auth)
        if (result) {
            await updateAuthToken(result.id, '')
            // set null auth token
        }
    }
    // remove cookie
    res.clearCookie('auth')
    res.redirect('/login');
});


// Route for home page.
app.get('/', async (req, res, next) => {
    res.redirect('/lobby')
})
app.use('/login', loginRouter)
// validator to verify user, only logged-in users can access these paths
app.use('/lobby',  authTokenValidator, lobbyRouter)
app.use('/game', authTokenValidator, gameRouter)
app.use('/api/lobby', authTokenValidator, lobbyApiRouter)

// Route to get currently logged in user information (/me)
app.get('/api/me', authTokenValidator, async (req, res) => {
    return res.json({ username: req.authDetails.username, profileImageUrl: req.authDetails.profile_image_url });
})

// Route to update profile image
app.post('/api/updateProfileImage', authTokenValidator, upload.single("avatar"), async (req, res) => {
  const profileImage = req.file;
  if (!profileImage) {
      return res.status(400).json({message: 'Profile image is required'});
  }

  // Get the filename of the uploaded file
  const filename = profileImage.filename;

  // Get the path of the uploaded file
  const profileImageUrl = path.join('uploads', filename);

  const result = await db('users').where('username', req.authDetails.username).update({profile_image_url: profileImageUrl})
  if (result === 1) {
    // Redirect to homepage.
    return res.redirect('/lobby');
  } else {
    return res.status(500).json({message: 'An error occurred while updating profile image'})
  }
})

// Authentication index.
app.post('/account-reg', (req, res) => {
    const {username, password, passwordVerify} = req.body;

    if (!username || !password || !passwordVerify) {
        return res.status(400).json({message: 'Username and password are required'});
    }

    // Ensure that the password & passwordVerify match
    if (password !== passwordVerify) {
        return res.status(400).json({message: 'Passwords do not match.'});
    }
    // Before adding to the database, ensure the username doesn't already exist.
    db('users')
        .where({username})
        .first()
        .then((user) => {
            if (user) {
                return res.status(400).json({message: 'Username already exists.'});
            } else {
                // Hash the password & store user into database.
                const saltRounds = 10;
                bcrypt.hash(password, saltRounds, (err, hash) => {
                    if (err) {
                        return res.status(500).json({message: 'An error occurred.'});
                    }
                    // Add the user to the database
                    db('users')
                        .insert({username, password: hash})
                        .then(() => {
                            // Redirect to homepage.
                            res.redirect('/');
                        })
                        .catch((err) => {
                            console.log(err);
                            res.status(500).json({message: 'An error occurred.'});
                        });
                });
            }
        });
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404));
});

// TODO error handler
// app.use();


const port = parseInt(process.env.PORT);
const host = process.env.HOST

// setup lobbies then start the server
initActiveLobbies().then(() => {
        server.listen(port, host, () => {
            if (isDocker) {
                console.log(`App is running at port 8080 or the port defined in docker-compose.yml`)
                return
            }

            console.log(`App is running at localhost:${port}`)
        })
    }
).catch(
    function (err) {
        console.log('failed to start app')
        console.log(err)
    }
)


module.exports = app;
