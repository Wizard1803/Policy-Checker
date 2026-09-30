const mongoose = require('mongoose');


const userSchema = new mongoose.Schema({
    username : {
        type : String , 
        required : true , 
        trim : true , 
        lowercase : true,
        unique : true,
        minlength : [3, 'Username must be at least 3 characters long'],

    },
    email : {
        type : String , 
        required : true , 
        trim : true , 
        lowercase : true,
        unique : true,
    },
    password : {
        type : String , 
        required : true , 
        trim : true ,
        minlength : [5, 'Password must be at least 5 characters long'],
    },
    tier: {
        type: String,
        enum: ['standard', 'pro', 'unlimited'],
        default: 'standard',
    },
    usage: {
        uploadsCount: { type: Number, default: 0, min: 0 },
        queriesCount: { type: Number, default: 0, min: 0 },
        lastResetDate: { type: Date, default: Date.now },
    },
})

const User = mongoose.model('user', userSchema);
module.exports = User;