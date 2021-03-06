const Member = require('../models').member;
const Story = require('../models').story;
const Annotation = require('../models').annotation;
const Comment = require('../models').comment;
const StoryActivity = require('../models').storyactivity;
const bcrypt = require('bcrypt');
const multer  = require('multer')
const storyController = require('./story');
const wikidataController = require('./wikidata');
const googleController = require('./google');
const sequelize = require('../models').sequelize;
const Op = require('sequelize').Op;
const LogStory = require('../models').logstory;
MEMBER_UPDATABLE_FIELDS = ['name', 'image','bio', 'email', 'wikidata', 'linkedin','twitter', 'facebook','instagram', 'github','tumblr' ,'website', 'password']
module.exports = {
  create(req, res) {
    return Member
      .create({
        username: req.body.username,
        first_name: req.body.first_name,
        last_name: req.body.last_name,
        email: req.body.email,
        password: req.body.password,
        type: 'basic'
      })
      .then(out => res.status(201).send(out))
      .catch(error => res.status(400).send(error));
  },
  register(req, res) {
    return Member
      .create({
        username: req.body.username.toLowerCase(),
        name: req.body.name,
        email: req.body.email.toLowerCase(),
        password: req.body.password,
        type: 'basic',
      }).then(user => {
              req.session.user = user.dataValues;
              res.redirect('/account');
          })
          .catch(error => {
            res.renderError('Trouble Creating Your Account');
          });
  },
  login(req, res) {
    var userinput = req.body.username.toLowerCase()
    return Member
      .findOne({ where:  {[Op.or]: [{username: userinput}, {email: userinput}] }})
      .then(function (user) {
        // console.log('USER-?', user)
        if (!user) {
            res.redirect('/login');
        } else if (! bcrypt.compareSync(req.body.pwd, user.password)) {
            res.redirect('/login');
        } else {
            req.session.user = user.dataValues;
            req.session.save(function(err) {
              return res.redirect('/overview');
            })
        }
    })
  },
  logout(req, res) {
    req.session.destroy(function(err) {
      if(err) {
        res.renderError('Oops... Problem Logging Out');
      } else {
        res.redirect('/');
      }
    });
  },
  list(req, res) {
    return Member
      .all()
      .then(out => res.status(200).send(out))
      .catch(error => res.status(400).send(error));
  },
  accessCheck(req, res, level, next){
    // Levels are public, user, author, admin
    if (level == 'public'){
      return next(req, res);
    }
    else{
      user = req.session.user;
      accessType = {
        'user': ['basic', 'author', 'admin'],
        'author': ['author', 'admin'],
        'admin': ['admin', ]
      }
      if (user && user.id){
        Member.findByPk(user.id)
        .then(member => {
          type = member.type
          req.session.user = member;
          if (accessType[level].indexOf(type) >= 0) {
            return next(req, res);
          }
          else res.renderError('unauthorized access');
        })
      }
      else res.renderError('unauthorized access')
    }
  },
  select(id, callback){
    return Member.findByPk(id).then(member => callback(member));
  },
  update(req, res) {
    var field = req.params.field
    if (MEMBER_UPDATABLE_FIELDS.includes(field)){
      return Member.findByPk(req.session.user.id)
      .then(member => {
        if (!member) {
          return res.status(404).send('Member Not Found');
        }
        var updateObj = {}
        if(field == 'password'){
          // Check old
          if (! bcrypt.compareSync(req.body.old, member.password)){
            return res.send('invalid_old')
          }
          const salt = bcrypt.genSaltSync();
          updateObj.password = bcrypt.hashSync(req.body.new, salt);
        }
        else{
          updateObj[field] = req.body.value
        }

        return member
          .update(updateObj)
          .then(updatedMember => {
            req.session.user = member;
            res.status(200).send('success')
          })
          .catch(error => res.status(400).send('error'));
      })
      .catch(error => res.status(400).send('error'));

    }
    else return res.status(400).send('Not proper field')
  },
  getActivityList(req, res, listName, filter, data, callback){
    return StoryActivity.findAll(filter)
      .then(activities => {
        allList = activities.dataValues
        favoriteList = []
        favQids = []
        for (i = 0; i < activities.length; i++){
            favoriteList.push(activities[i].dataValues)
            favQids.push(activities[i].dataValues.story.qid)
        }
        wikidataController.getDetailsList(req, res, favQids, 'small',false,'https://upload.wikimedia.org/wikipedia/commons/a/ad/Placeholder_no_text.svg',
          function(favList){
            data[listName] = favList
            callback(data)
          })

      })
  },
  loggedIn(req) {
    if (req.session && req.session.user && req.session.user.id) return true
    else return false
  },
  homeRedirect(req, res) {
    if (module.exports.loggedIn(req)) res.redirect('/overview')
    else res.redirect('/')
  },
  profile(req, res) {
    return res.redirect('/member:'+req.session.user.username)
  },
  overview(req, res) {
    return Member.findByPk(req.session.user.id)
    .then(member => {
      req.session.user = member;
      //find Favorites
      favFilter = {where: {memberId: member.id, favorite: 1},
        order: [
            ['updatedAt', 'DESC'],
        ],
        include: [
          { model: Story, required: true, as:'story'}
        ],}
      topFilter = {where: {memberId: member.id},
        order: [
            ['views', 'DESC'],
        ],
        limit: 10,
        include: [
          { model: Story, required: true, as:'story'}
        ],}
      data = {user:member}
      module.exports.getActivityList(req, res, 'favorites', favFilter, data, function(favoriteActivity){
        module.exports.getActivityList(req, res, 'mostViews', topFilter, data, function(favoriteActivity){
            return googleController.getPopularStories(['week'], 10,  function(out){
              var rows = out.rows
              resultObj = {}
              for (var i = 0; i < rows.length; i++) {
                var qid = rows[i].dimensions[0].substr(1).toUpperCase()
                var storyCount = parseInt(rows[i].metrics[0].values[0]);
                if (resultObj[qid]) resultObj[qid] += storyCount
                else resultObj[qid] = storyCount
              }
              // Create items array
              var items = Object.keys(resultObj).map(function(key) {
                return [key, resultObj[key]];
              });

              // Sort the array based on the second element
              items.sort(function(first, second) {
                return second[1] - first[1];
              });
              trendList = items.map(function(key){
                return key[0];
              })
              let defaultImg = 'https://upload.wikimedia.org/wikipedia/commons/a/ad/Placeholder_no_text.svg';
              return wikidataController.getDetailsList(req, res, trendList,
                'small', false, defaultImg, (trendData) => {
                  data.trending = trendData;
                  let featured_stories = storyController.getFeaturedList();
                  let pageData = {
                    title: `Overview (${member.name})`,
                    profile_nav:function(){ return "overview"},
                    subtitle: "WELCOME BACK",
                    data:data,
                    featured_stories: featured_stories
                  }
                  return res.renderPage('base', 'profile', pageData);
                })

            })

        })

      } )

    })
  },
  memberPage(req, res) {
    return Member.findOne({where: {username:req.params.username.toLowerCase()}})
    .then(member => {
      if (!member) return res.renderError('There is no user with the username: '
        + req.params.username)

      //find Favorites
      favFilter = {
        where: {memberId: member.id, favorite: 1},
        order: [['updatedAt', 'DESC']],
        include: [{ model: Story, required: true, as: 'story'}]
      }
      topFilter = {
        where: {memberId: member.id},
        order: [['views', 'DESC']],
        limit: 10,
        include: [{ model: Story, required: true, as: 'story'}]
      }
      data = {member: member}
      meta = {description: `${member.name} is a member on Science Stories. ${member.bio} | Join Science Stories to connect with ${member.name} and others you may know.`}
      module.exports.getActivityList(req, res, 'favorites', favFilter, data, function(favoriteActivity){
        module.exports.getActivityList(req, res, 'views', topFilter, data, function(viewActivity){
        module.exports.getMemberActivity([member.id], 25, function(feed_list){
          data.feed_list = feed_list
          module.exports.getContributionCount(member.id, function(total_contributed_stories){
            data.contributed_total = total_contributed_stories
            let pageData = {
              title: member.name + ' Member Page',
              data: data,
              meta: meta
            }
            return res.renderPage('base', 'member', pageData)
          })
        })
      } )} )
    })
  },
  getContributionCount(memberId, callback){
    return LogStory.findAll({where: {memberId:memberId}, attributes:[], group: ['storyId'] })
     .then(total => callback(total.length))
  },
  getContributionGallery(req, res){
    memberName = req.params.member
    pageNumber = req.params.pageNumber
    return Member.findOne({where:{username:memberName}}).then(member => {
      return LogStory.findAll({where: {memberId:member.id}, attributes:['storyId','updatedAt'], order: [['updatedAt', 'DESC']], include:[{model: Story, as :'story', attributes:['id','qid', 'data']} ]})
      .then(contributedStories => {
        var qidsContributed = []
        var qidsContributedMap = {}
        var contributedDataList = []
        for (var i = 0; i < contributedStories.length; i++) {
          var tempQid = contributedStories[i].dataValues.story.qid
          if(!qidsContributedMap[tempQid]){
            qidsContributed.push(tempQid)
            contributedDataList.push(contributedStories[i].dataValues.story.data)
            qidsContributedMap[tempQid] = true
          }
        }

        var stories_per_page = 25
        var total_stories = qidsContributed.length
        maxPage = Math.ceil(total_stories/stories_per_page) + 1
        nextPage = (pageNumber == maxPage) ? 0 : pageNumber + 1
        prevPage = (pageNumber == 1) ? 0 : pageNumber - 1
        offset = (pageNumber-1)*stories_per_page
        qidsContributed = qidsContributed.slice(offset, offset+stories_per_page)
        contributedDataList = contributedDataList.slice(offset, offset+stories_per_page)
        if (!qidsContributed.length) return res.status(404).send('No more stories.')
        data = {totalStories:total_stories, page:pageNumber, maxPage: maxPage, prevPage:prevPage, nextPage:nextPage}
        // return res.send(qidsContributed)
        return wikidataController.getDetailsList(req, res, qidsContributed, 'small_with_age', 'first', false,
          function(qidList){
            for (var i = 0; i < qidList.length; i++) {
              if(!qidList[i].image){
                for (var k = 0; k < contributedDataList[i].length; k++) {
                  if (contributedDataList[i][k].image){
                    qidList[i].image = contributedDataList[i][k].image
                    break;
                  }
                }
              }
            }
            data['list'] = qidList
            data.page = function(){ return 'story_gallery'}
            return res.render('blank', data)


          })

      })
    })

  },
  getMemberActivity(members, max_size, callback){

    faveWhere = (members != false) ? {favorite:1, memberId:members} : {favorite:1}
    return StoryActivity.findAll( {where:faveWhere, order: [['lastFavorited', 'DESC'], ], imit:max_size, include:[{model: Story, as :'story'}, {model: Member, as :'member'}]})
    .then(faveItems => {
      for (var i = 0; i < faveItems.length; i++) {
        faveItems[i].dataValues['feed_type'] = 'favorite'
        faveItems[i].dataValues['feed_date'] = faveItems[i].dataValues.lastFavorited
      }
      commentWhere = (members != false) ? {memberId:members} : {}
      return Comment.findAll({where: commentWhere, order: [['createdAt', 'DESC']], limit:max_size, include:[{model: Story, as :'story'}, {model: Member, as :'member'}]})
        .then(commentItems => {
          for (var i = 0; i < commentItems.length; i++) {
            commentItems[i].dataValues['feed_type'] = 'comment'
            commentItems[i].dataValues['feed_date'] = commentItems[i].dataValues.updatedAt
          }
          logWhere = (members != false) ? {memberId:members} : {}
          return LogStory.findAll({where: logWhere, order: [['updatedAt', 'DESC']], limit:max_size, include:[{model: Story, as :'story'}, {model: Member, as :'member'}, ]})
            .then(updateItems => {
              for (var i = 0; i < updateItems.length; i++) {
                updateItems[i].dataValues['feed_type'] = 'update'
                updateItems[i].dataValues['feed_date'] = updateItems[i].dataValues.updatedAt
              }
              // Create items array
                  masterItems = [].concat(faveItems, commentItems, updateItems)
                  // Sort the array based on the second element
                  masterItems.sort(function(first, second) {
                  return second.dataValues.feed_date - first.dataValues.feed_date;
                  });
              // res.send(masterItems)
              return callback(masterItems.slice(0,max_size))

            })
        })
    })
  },
  feed(req, res){
    return Member.findByPk(req.session.user.id).then(member => {
      req.session.user = member;
      module.exports.getMemberActivity(false, 25, feed_list => {
        let pageData = {
          title: `Story Feed (${member.name})`,
          profile_nav:function(){ return "feed"},
          subtitle: "NEWS FEED",
          data: {user:member, feed_list: feed_list}
        };
        return res.renderPage('base', 'profile', pageData);
      })
    })
  },
  account(req, res){
    return req.member(member => {
      let pageData = {
        title: `Account Settings (${member.name})`,
        nav:'account',
        profile_nav: () => "account",
        subtitle: "ACCOUNT SETTINGS",
        data: {user: member}
      }
      return res.renderPage('base', 'profile', pageData)
    })
  },
  contributions(req, res){
    return req.member(member => {
      return module.exports.getContributionCount(member.id, (total) => {
        let pageData = {
          title: `Contributions (${member.name})`,
          nav: 'contributions',
          profile_nav: () => "contributions",
          subtitle: "CONTRIBUTIONS",
          data: {user: member, contribution_total: total}
        }
        return res.renderPage('base', 'profile', pageData);
      });
    });
  },
  admin(req, res){
    return req.member(member => {
      return Member.findAll({group: ['type'], attributes: ['type', [sequelize.fn('COUNT', 'type'), 'MemberCount']],})
      .then(membersRaw => {
        memberCount = {}
        for (var i = 0; i < membersRaw.length; i++) {
          memberCount[membersRaw[i].dataValues.type] = membersRaw[i].dataValues.MemberCount
        }
        return Story.count()
        .then(storyCount => {
          return sequelize.query("select count(id) from stories where stories.data::text <> '{}'::text;", { model: Story })
          .then(emptyCount => {
            emptyCount = emptyCount[0].dataValues.count;
            return Annotation.count().then(annotations => {
              return StoryActivity.count({where: {favorite:1}}).then(faves => {
                return Comment.count().then(commentCount => {
                  return LogStory.count().then(edits => {
                    return googleController.getAdminStats(googleStats => {
                      let pageData = {
                        title: `Admin Panel (${member.name})`,
                        nav: 'admin',
                        profile_nav: () => "admin",
                        subtitle: "ADMIN PANEL",
                        data: {
                          user:member,
                          counts: {
                            members: memberCount, stories: storyCount,
                            empty: emptyCount, favorites: faves, edits: edits,
                            comments: commentCount, annotations: annotations,
                            google: googleStats
                          }
                        }
                      };
                      return res.renderPage('base', 'profile', pageData);
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  },
  destroy(req, res) {
    return Member
      .findOne({
          where: {
            id: req.params.MemberId,
            bracketId: req.params.bracketId,
          },
        })
      .then(out => {
        if (!out) {
          return res.status(404).send({
            message: 'Member Not Found',
          });
        }

        return out
          .destroy()
          .then(() => res.status(200).send({ message: 'Player deleted successfully.' }))
          .catch(error => res.status(400).send(error));
      })
      .catch(error => res.status(400).send(error));
  },
  toggleFavorite(req, res) {
    StoryActivity.findOne({where: {memberId: req.session.user.id, storyId:req.body.storyId}})
      .then(activity => {
        newVal = (activity.favorite) ? 0 : 1
        activity.update({favorite: newVal, lastFavorited: sequelize.fn('NOW')})
          .then(out => res.send(out))
      })
  },
};
